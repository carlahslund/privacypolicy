package com.graciebarra.roundtimer.tv

import java.util.Locale

/**
 * Renders /api/state.
 *
 * Kept apart from the server, and free of Android, because this payload is the contract
 * every client reads — the TV display, a coach's phone, and the Windows build's own
 * pages. [StateJsonTest] pins the exact shape.
 */
object StateJson {

    fun render(
        snapshot: TimerSnapshot,
        paired: Boolean,
        pin: String,
        urls: List<String>,
        epochMillis: Long
    ): String {
        val config = snapshot.config
        val events = snapshot.events.joinToString(",") { event ->
            """{"id":${event.id},"kind":"${event.kind}","epoch":${decimals(event.epochSeconds, 3)}}"""
        }
        return buildString {
            append("""{"config":{"preset":"${escape(config.preset)}","round":${config.round}""")
            append(""","rest":${config.rest},"rounds":${config.rounds}""")
            append(""","position":"${escape(config.position)}"""")
            append(""","alternate":${config.alternate},"warning":${config.warning}""")
            append(""","buzzer":"${escape(config.buzzer)}","buzzer_volume":${decimals(config.volume, 2)}}""")
            append(""","phase":"${snapshot.phase}","round_number":${snapshot.roundNumber}""")
            append(""","running":${snapshot.running},"seconds":${decimals(snapshot.seconds, 3)}""")
            append(""","server_epoch_ms":$epochMillis""")
            append(""","paired":$paired""")
            append(""","pair_pin":${if (paired) "\"${escape(pin)}\"" else "null"}""")
            append(""","local_url":${urls.firstOrNull()?.let { "\"${escape(it)}\"" } ?: "null"}""")
            append(""","local_urls":[${urls.joinToString(",") { "\"${escape(it)}\"" }}]""")
            append(""","events":[$events]}""")
        }
    }

    /** Locale.US on purpose: a Danish TV must not send "3,00" to the controller. */
    private fun decimals(value: Double, places: Int) = String.format(Locale.US, "%.${places}f", value)

    private fun escape(value: String) = buildString {
        for (character in value) {
            when {
                character == '"' -> append("\\\"")
                character == '\\' -> append("\\\\")
                character == '\n' || character == '\r' || character == '\t' -> append(' ')
                character < ' ' -> Unit
                else -> append(character)
            }
        }
    }
}
