package com.graciebarra.roundtimer.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The same scenarios `tv/tests/timer-core.test.js` runs against the JavaScript engine.
 * Both implementations have to agree, because a gym can have the Samsung app on the mat
 * TV and the Android app on another, reading from the same phone.
 */
class TimerEngineTest {

    private class Harness(config: TimerConfig = TimerConfig()) {
        var clock = 0L
        val engine = TimerEngine(config, monotonicMillis = { clock }, wallMillis = { 1_700_000_000_000L + clock })
        fun advance(seconds: Double) {
            clock += (seconds * 1000).toLong()
            engine.tick()
        }
        fun kinds(): List<String> = engine.snapshot().events.map { it.kind }
        fun where(): String {
            val s = engine.snapshot()
            return "${s.phase}/${s.roundNumber}/${Math.round(s.seconds)}/${s.running}"
        }
    }

    private val positional = TimerConfig("positional", 180, 30, 3, "Half Guard", true, true, "classic", 0.8)

    @Test
    fun `runs a whole class from ready to complete`() {
        val h = Harness(positional)
        assertEquals("idle/1/180/false", h.where())

        h.engine.action("toggle")
        assertEquals("round/1/180/true", h.where())
        assertEquals(listOf("start_round"), h.kinds())

        h.advance(169.0)
        assertEquals("no warning while 11 seconds remain", listOf("start_round"), h.kinds())
        h.advance(1.0)
        assertEquals(listOf("start_round", "warning"), h.kinds())
        assertEquals("round/1/10/true", h.where())

        h.advance(5.0)
        assertEquals("the warning fires once a round", listOf("start_round", "warning"), h.kinds())

        h.advance(5.0)
        assertEquals("rest/1/30/true", h.where())
        assertEquals(listOf("start_round", "warning", "end_round"), h.kinds())

        h.advance(30.0)
        assertEquals("round/2/180/true", h.where())
        assertEquals(listOf("end_rest", "start_round"), h.kinds().takeLast(2))

        h.advance(210.0)
        assertEquals("round 2 and its rest both elapse", "round/3/180/true", h.where())

        h.advance(180.0)
        assertEquals("the last round has no trailing rest", "complete/3/0/false", h.where())
        assertEquals(listOf("end_round"), h.kinds().takeLast(1))

        h.engine.action("toggle")
        assertEquals("round/1/180/true", h.where())
    }

    @Test
    fun `a stalled shell does not drift the session`() {
        val h = Harness(TimerConfig("shark", 120, 15, 4, "", false, false, "bell", 0.5))
        h.engine.action("toggle")
        h.advance(300.0)
        assertEquals("round/3/90/true", h.where())
    }

    @Test
    fun `pauses, resumes and nudges`() {
        val h = Harness(TimerConfig("regular", 300, 60, 5, "", false, true, "classic", 0.8))
        h.engine.action("toggle")
        h.advance(20.0)
        h.engine.action("toggle")
        assertEquals("round/1/280/false", h.where())
        h.advance(45.0)
        assertEquals("a paused clock stays put", "round/1/280/false", h.where())
        h.engine.action("toggle")
        h.advance(10.0)
        assertEquals("round/1/270/true", h.where())
        h.engine.action("plus")
        assertEquals("round/1/280/true", h.where())
        h.engine.action("minus")
        h.engine.action("minus")
        assertEquals("round/1/260/true", h.where())
    }

    @Test
    fun `skipping a segment stays silent`() {
        val h = Harness(TimerConfig("positional", 180, 30, 6, "", false, true, "classic", 0.8))
        h.engine.action("toggle")
        h.advance(5.0)
        val before = h.kinds().size

        h.engine.action("next")
        assertEquals("rest/1/30/true", h.where())
        h.engine.action("next")
        assertEquals("round/2/180/true", h.where())

        h.advance(40.0)
        h.engine.action("previous")
        assertEquals("previous mid-round restarts it", "round/2/180/true", h.where())
        h.engine.action("previous")
        assertEquals("previous at the top steps back", "round/1/180/true", h.where())
        h.engine.action("previous")
        assertEquals("previous stops at round one", "round/1/180/true", h.where())
        assertEquals("no buzzer for a deliberate skip", before, h.kinds().size)

        h.engine.action("reset")
        assertEquals("idle/1/180/false", h.where())
    }

    @Test
    fun `open mat counts up and never completes`() {
        val h = Harness(TimerConfig("open", 0, 0, 1, "", false, false, "classic", 0.8))
        assertEquals("idle/1/0/false", h.where())
        h.engine.action("toggle")
        h.advance(125.0)
        assertEquals("round/1/125/true", h.where())
        h.advance(600.0)
        assertEquals("round", h.engine.snapshot().phase)
    }

    @Test
    fun `the manual buzzer only makes a noise`() {
        val h = Harness()
        h.engine.action("buzzer")
        assertEquals(listOf("manual"), h.kinds())
        assertEquals("idle/1/180/false", h.where())
    }

    @Test
    fun `rounds run back to back when no rest is configured`() {
        val h = Harness(TimerConfig("custom", 60, 0, 3, "", false, false, "digital", 1.0))
        h.engine.action("toggle")
        h.advance(60.0)
        assertEquals("round/2/60/true", h.where())
        assertEquals(listOf("end_round", "start_round"), h.kinds().takeLast(2))
    }

    @Test
    fun `settings are validated the way the server validates them`() {
        assertNull(sanitise(rounds = 0))
        assertNull(sanitise(rounds = 100))
        assertNull(sanitise(round = 0))
        assertNull(sanitise(round = -5))
        assertEquals("custom", sanitise(preset = "nonsense")!!.preset)
        assertEquals("classic", sanitise(buzzer = "kazoo")!!.buzzer)
        assertEquals(1.0, sanitise(volume = 9.0)!!.volume, 0.0001)
        assertEquals(0.1, sanitise(volume = 0.0)!!.volume, 0.0001)

        val open = sanitise(preset = "open", round = 300, rest = 60, rounds = 5)!!
        assertEquals(TimerConfig("open", 0, 0, 1, "", false, false, "classic", 0.8), open)

        assertEquals("Turtle escapes", sanitise(preset = "custom", position = "Turtle escapes")!!.position)
        assertEquals("a long position is trimmed, not rejected", 40, sanitise(position = "x".repeat(120))!!.position.length)
    }

    @Test
    fun `applying settings restarts the session and bad settings change nothing`() {
        val h = Harness()
        h.engine.action("toggle")
        h.advance(60.0)
        assertTrue(h.engine.apply(sanitise(preset = "ten", round = 600, rest = 60, rounds = 4, position = "Mount")))
        assertEquals("idle/1/600/false", h.where())
        assertFalse(h.engine.apply(sanitise(round = -5)))
        assertEquals(600, h.engine.config.round)
    }

    @Test
    fun `unknown actions are refused`() {
        val h = Harness()
        assertFalse(h.engine.action("selfDestruct"))
        assertTrue(TimerEngine.ACTIONS.all { h.engine.action(it) })
    }

    private fun sanitise(
        preset: String = "regular",
        round: Int = 300,
        rest: Int = 60,
        rounds: Int = 5,
        position: String = "",
        alternate: Boolean = false,
        warning: Boolean = false,
        buzzer: String = "classic",
        volume: Double = 0.8
    ) = TimerEngine.sanitise(preset, round, rest, rounds, position, alternate, warning, buzzer, volume)
}
