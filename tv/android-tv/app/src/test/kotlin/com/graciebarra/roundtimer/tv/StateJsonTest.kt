package com.graciebarra.roundtimer.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The /api/state payload is the contract between this app and every controller that
 * points at it, including phones that were paired with the Windows build. These tests
 * pin the shape field by field.
 */
class StateJsonTest {

    private val config = TimerConfig("positional", 180, 30, 6, "Half Guard", true, true, "classic", 0.8)

    @Test
    fun `an unpaired controller is told the session but not the code`() {
        val json = StateJson.render(
            TimerSnapshot(config, "idle", 1, false, 180.0, emptyList()),
            paired = false,
            pin = "123456",
            urls = emptyList(),
            epochMillis = 1_700_000_000_000L
        )
        assertEquals(
            """{"config":{"preset":"positional","round":180,"rest":30,"rounds":6,"position":"Half Guard",""" +
                """"alternate":true,"warning":true,"buzzer":"classic","buzzer_volume":0.80},""" +
                """"phase":"idle","round_number":1,"running":false,"seconds":180.000,""" +
                """"server_epoch_ms":1700000000000,"paired":false,"pair_pin":null,""" +
                """"local_url":null,"local_urls":[],"events":[]}""",
            json
        )
    }

    @Test
    fun `a paired controller gets the code, the addresses and the buzzer queue`() {
        val json = StateJson.render(
            TimerSnapshot(
                config.copy(preset = "custom", round = 195, buzzer = "bell", volume = 0.55),
                "round", 3, true, 12.25,
                listOf(TimerEvent(7, "warning", 1_700_000_000.5), TimerEvent(8, "end_round", 1_700_000_010.25))
            ),
            paired = true,
            pin = "004821",
            urls = listOf("http://192.168.1.42:8765/control", "http://10.0.0.9:8765/control"),
            epochMillis = 1_700_000_010_500L
        )
        assertEquals(
            """{"config":{"preset":"custom","round":195,"rest":30,"rounds":6,"position":"Half Guard",""" +
                """"alternate":true,"warning":true,"buzzer":"bell","buzzer_volume":0.55},""" +
                """"phase":"round","round_number":3,"running":true,"seconds":12.250,""" +
                """"server_epoch_ms":1700000010500,"paired":true,"pair_pin":"004821",""" +
                """"local_url":"http://192.168.1.42:8765/control",""" +
                """"local_urls":["http://192.168.1.42:8765/control","http://10.0.0.9:8765/control"],""" +
                """"events":[{"id":7,"kind":"warning","epoch":1700000000.500},""" +
                """{"id":8,"kind":"end_round","epoch":1700000010.250}]}""",
            json
        )
    }

    @Test
    fun `a coach's own wording cannot break the payload`() {
        val json = StateJson.render(
            TimerSnapshot(config.copy(position = "Half \"guard\" \\ drills\nfast"), "round", 1, true, 9.5, emptyList()),
            paired = true,
            pin = "111111",
            urls = emptyList(),
            epochMillis = 0L
        )
        assertTrue(json, json.contains(""""position":"Half \"guard\" \\ drills fast""""))
    }

    @Test
    fun `decimals never pick up a comma`() {
        val previous = java.util.Locale.getDefault()
        try {
            java.util.Locale.setDefault(java.util.Locale.forLanguageTag("da-DK"))
            val json = StateJson.render(
                TimerSnapshot(config, "round", 1, true, 90.5, emptyList()),
                paired = false, pin = "000000", urls = emptyList(), epochMillis = 0L
            )
            assertTrue(json, json.contains(""""seconds":90.500"""))
            assertTrue(json, json.contains(""""buzzer_volume":0.80"""))
        } finally {
            java.util.Locale.setDefault(previous)
        }
    }
}
