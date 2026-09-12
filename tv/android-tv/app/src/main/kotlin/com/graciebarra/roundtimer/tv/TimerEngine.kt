package com.graciebarra.roundtimer.tv

/**
 * The session state machine, shared with `tv/shared/web/timer-core.js` and with the
 * Windows build before it. `tv/tests/timer-core.test.js` and [TimerEngineTest] run the
 * same scenarios against the two implementations, so a change to one shows up as a
 * failure in the other.
 *
 * Free of Android APIs on purpose: the clocks are injected, which keeps it unit
 * testable on a plain JVM and lets the tests run a whole class in microseconds.
 */

data class TimerConfig(
    val preset: String = "positional",
    val round: Int = 180,
    val rest: Int = 30,
    val rounds: Int = 6,
    val position: String = "Half Guard",
    val alternate: Boolean = true,
    val warning: Boolean = true,
    val buzzer: String = "classic",
    val volume: Double = 0.8
) {
    val isOpenMat: Boolean get() = preset == "open"
}

data class TimerEvent(val id: Long, val kind: String, val epochSeconds: Double)

data class TimerSnapshot(
    val config: TimerConfig,
    val phase: String,
    val roundNumber: Int,
    val running: Boolean,
    val seconds: Double,
    val events: List<TimerEvent>
)

class TimerEngine(
    config: TimerConfig = TimerConfig(),
    private val monotonicMillis: () -> Long = { System.nanoTime() / 1_000_000L },
    private val wallMillis: () -> Long = { System.currentTimeMillis() }
) {
    companion object {
        val PRESETS: Map<String, Pair<Int, Int>> = mapOf(
            "positional" to (180 to 30),
            "regular" to (300 to 60),
            "competition" to (360 to 60),
            "eight" to (480 to 60),
            "ten" to (600 to 60),
            "shark" to (120 to 15),
            "open" to (0 to 0)
        )
        val PRESET_NAMES = listOf("regular", "competition", "eight", "ten", "positional", "shark", "open", "custom")
        val BUZZERS = listOf("classic", "airhorn", "bell", "digital")
        val ACTIONS = listOf("toggle", "reset", "next", "previous", "plus", "minus", "buzzer")

        private const val MAX_EVENTS = 16
        private const val WARNING_AT = 10.0
        private const val NUDGE = 10.0
        private const val PREVIOUS_RESTART_WINDOW = 2.0

        /** Rejects whatever the server would have rejected; null means "invalid settings". */
        fun sanitise(
            preset: String?,
            round: Int,
            rest: Int,
            rounds: Int,
            position: String?,
            alternate: Boolean,
            warning: Boolean,
            buzzer: String?,
            volume: Double
        ): TimerConfig? {
            val name = if (preset != null && PRESET_NAMES.contains(preset)) preset else "custom"
            if (round < 0 || round > 3599 || rest < 0 || rest > 3599) return null
            if (rounds < 1 || rounds > 99) return null
            if (name != "open" && round < 1) return null
            val open = name == "open"
            val clean = if (volume.isNaN()) 0.8 else Math.round(volume * 100.0) / 100.0
            return TimerConfig(
                preset = name,
                round = if (open) 0 else round,
                rest = if (open) 0 else rest,
                rounds = if (open) 1 else rounds,
                position = (position ?: "").take(40),
                alternate = !open && alternate,
                warning = !open && warning,
                buzzer = if (buzzer != null && BUZZERS.contains(buzzer)) buzzer else "classic",
                volume = clean.coerceIn(0.1, 1.0)
            )
        }
    }

    var config: TimerConfig = config
        private set

    private var phase = "idle"
    private var roundNumber = 1
    private var running = false
    private var warned = false
    private var seconds = 0.0
    private var mark = 0L
    private var eventId = 0L
    private val events = ArrayDeque<TimerEvent>()
    private var listener: ((TimerEvent, TimerConfig) -> Unit)? = null

    init {
        resetInternal()
    }

    /** Called on the engine's own thread the moment a buzzer is due. */
    fun onEvent(block: (TimerEvent, TimerConfig) -> Unit) {
        listener = block
    }

    private fun resetInternal() {
        phase = "idle"
        roundNumber = 1
        running = false
        warned = false
        seconds = if (config.isOpenMat) 0.0 else config.round.toDouble()
        mark = monotonicMillis()
    }

    /** Allowed to go negative so [tick] can see how far past a buzzer a stall went. */
    private fun rawRemaining(at: Long): Double {
        if (!running) return seconds
        val elapsed = (at - mark) / 1000.0
        return if (config.isOpenMat) seconds + elapsed else seconds - elapsed
    }

    private fun remaining(at: Long): Double {
        val left = rawRemaining(at)
        return if (config.isOpenMat) left else maxOf(0.0, left)
    }

    private fun hold(at: Long, value: Double) {
        seconds = value
        mark = at
    }

    private fun emit(kind: String, at: Long) {
        eventId += 1
        val event = TimerEvent(eventId, kind, wallMillis() / 1000.0)
        events.addLast(event)
        while (events.size > MAX_EVENTS) events.removeFirst()
        listener?.invoke(event, config)
    }

    /** Moves on from a finished segment. A deliberate skip passes audible = false. */
    private fun advance(at: Long, audible: Boolean) {
        if (phase == "rest") {
            if (audible) emit("end_rest", at)
            roundNumber += 1
            phase = "round"
            warned = false
            hold(at, config.round.toDouble())
            if (audible) emit("start_round", at)
            return
        }
        if (audible) emit("end_round", at)
        if (roundNumber >= config.rounds) {
            phase = "complete"
            running = false
            hold(at, 0.0)
            return
        }
        if (config.rest > 0) {
            phase = "rest"
            hold(at, config.rest.toDouble())
            return
        }
        roundNumber += 1
        phase = "round"
        warned = false
        hold(at, config.round.toDouble())
        if (audible) emit("start_round", at)
    }

    @Synchronized
    fun tick() {
        val at = monotonicMillis()
        if (!running || phase == "idle" || phase == "complete" || config.isOpenMat) return

        var guard = 0
        while (guard < 64) {
            val left = rawRemaining(at)
            if (phase == "round" && config.warning && !warned && left > 0 && left <= WARNING_AT) {
                warned = true
                emit("warning", at)
            }
            if (left > 0) break
            /* Roll back to the instant the segment really expired, so a TV that slept
               through three rounds lands where it should instead of drifting. */
            val expiredAt = at + (left * 1000).toLong()
            hold(expiredAt, 0.0)
            advance(expiredAt, true)
            if (!running) break
            guard += 1
        }
    }

    @Synchronized
    fun action(name: String): Boolean {
        tick()
        val at = monotonicMillis()
        when (name) {
            "toggle" -> {
                if (phase == "complete") resetInternal()
                if (phase == "idle") {
                    phase = "round"
                    roundNumber = 1
                    warned = false
                    hold(at, if (config.isOpenMat) 0.0 else config.round.toDouble())
                    running = true
                    emit("start_round", at)
                    return true
                }
                if (running) {
                    hold(at, remaining(at))
                    running = false
                } else {
                    mark = at
                    running = true
                }
            }

            "reset" -> resetInternal()

            "next" -> {
                if (phase == "idle" || phase == "complete") return true
                if (config.isOpenMat) {
                    hold(at, 0.0)
                    return true
                }
                hold(at, 0.0)
                advance(at, false)
            }

            "previous" -> {
                if (phase == "idle") return true
                if (config.isOpenMat) {
                    hold(at, 0.0)
                    return true
                }
                when {
                    phase == "complete" -> {
                        phase = "round"
                        roundNumber = config.rounds
                    }
                    phase == "rest" -> phase = "round"
                    remaining(at) > config.round - PREVIOUS_RESTART_WINDOW && roundNumber > 1 -> roundNumber -= 1
                }
                warned = false
                hold(at, config.round.toDouble())
            }

            "plus", "minus" -> {
                val step = if (name == "plus") NUDGE else -NUDGE
                if (phase == "idle" || phase == "complete") {
                    if (config.isOpenMat) return true
                    hold(at, maxOf(0.0, seconds + step))
                    return true
                }
                hold(at, maxOf(0.0, remaining(at) + step))
                if (config.warning && seconds > WARNING_AT) warned = false
            }

            "buzzer" -> emit("manual", at)

            else -> return false
        }
        return true
    }

    /** Applying settings restarts the session, exactly as the control panel warns. */
    @Synchronized
    fun apply(next: TimerConfig?): Boolean {
        if (next == null) return false
        config = next
        resetInternal()
        return true
    }

    @Synchronized
    fun snapshot(): TimerSnapshot {
        tick()
        val at = monotonicMillis()
        return TimerSnapshot(
            config = config,
            phase = phase,
            roundNumber = roundNumber,
            running = running,
            seconds = Math.round(remaining(at) * 1000.0) / 1000.0,
            events = events.toList()
        )
    }
}
