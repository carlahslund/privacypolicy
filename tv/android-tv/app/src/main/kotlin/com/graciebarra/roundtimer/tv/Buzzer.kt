package com.graciebarra.roundtimer.tv

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.util.Log
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.sin

/**
 * The buzzer, rebuilt in PCM.
 *
 * In a browser the gym has to click ENABLE SOUND before the round can end loudly,
 * because autoplay rules do not care that it is a wall-mounted timer. A TV app owns its
 * speakers, so the same four voices are synthesised here instead — same frequencies,
 * same envelopes, same timings as the WebAudio versions in the shared app.js — and the
 * WebView is told to stay quiet.
 */
class Buzzer {

    private class Partial(
        val frequency: Double,
        val start: Double,
        val length: Double,
        val peak: Double,
        val shape: Shape
    )

    private enum class Shape { SAW, SINE, BELL }

    companion object {
        private const val TAG = "Buzzer"
        private const val RATE = 44100
        private const val FLOOR = 0.001
    }

    private val handler = Handler(Looper.getMainLooper())
    private var track: AudioTrack? = null

    fun play(kind: String, style: String, volume: Double) {
        val partials = voice(kind, style, volume.coerceIn(0.0, 1.0)) ?: return
        try {
            playPcm(render(partials))
        } catch (error: Exception) {
            Log.w(TAG, "could not sound the buzzer", error)
        }
    }

    fun release() {
        stopTrack()
    }

    private fun voice(kind: String, style: String, volume: Double): List<Partial>? = when (kind) {
        "warning" -> listOf(Partial(900.0, 0.0, 0.19, 0.16, Shape.SINE))

        "end_round", "manual" -> when (style) {
            "airhorn" -> listOf(0.0, 0.95).flatMap { start ->
                listOf(
                    Partial(140.0, start, 0.82, 0.25 * volume, Shape.SAW),
                    Partial(146.0, start, 0.82, 0.17 * volume, Shape.SAW),
                    Partial(195.0, start, 0.82, 0.12 * volume, Shape.SAW)
                )
            }

            "bell" -> listOf(0.0, 0.73, 1.46).flatMap { start ->
                listOf(
                    Partial(620.0, start, 1.25, 0.21 * volume, Shape.BELL),
                    Partial(930.0, start, 1.20, 0.13 * volume, Shape.BELL),
                    Partial(1240.0, start, 0.95, 0.09 * volume, Shape.BELL)
                )
            }

            "digital" -> listOf(660.0, 880.0, 1100.0, 880.0).mapIndexed { index, frequency ->
                Partial(frequency, index * 0.28, 0.23, 0.27 * volume, Shape.SINE)
            }

            else -> listOf(
                Partial(185.0, 0.0, 0.70, 0.35 * volume, Shape.SAW),
                Partial(192.0, 0.0, 0.70, 0.22 * volume, Shape.SAW),
                Partial(185.0, 0.82, 0.65, 0.35 * volume, Shape.SAW),
                Partial(192.0, 0.82, 0.65, 0.22 * volume, Shape.SAW)
            )
        }

        "end_rest" -> listOf(
            Partial(370.0, 0.0, 0.42, 0.25, Shape.SAW),
            Partial(470.0, 0.50, 0.42, 0.25, Shape.SAW)
        )

        /* start_round is deliberately silent — the round buzzer already announced it. */
        else -> null
    }

    private fun render(partials: List<Partial>): ShortArray {
        val duration = partials.maxOf { it.start + it.length } + 0.05
        val frames = (duration * RATE).toInt()
        val mix = DoubleArray(frames)

        for (partial in partials) {
            val from = (partial.start * RATE).toInt()
            val to = ((partial.start + partial.length) * RATE).toInt().coerceAtMost(frames)
            if (from >= to) continue
            val step = partial.frequency / RATE
            for (index in from until to) {
                val elapsed = (index - from).toDouble() / RATE
                val phase = (index - from) * step
                val wave = when (partial.shape) {
                    Shape.SAW -> 2.0 * (phase - floor(phase + 0.5))
                    else -> sin(2.0 * PI * phase)
                }
                mix[index] += wave * envelope(partial, elapsed)
            }
        }

        val pcm = ShortArray(frames)
        for (index in 0 until frames) {
            pcm[index] = (mix[index].coerceIn(-1.0, 1.0) * Short.MAX_VALUE).toInt().toShort()
        }
        return pcm
    }

    /** The exponential attack-hold-decay the WebAudio gain nodes describe. */
    private fun envelope(partial: Partial, elapsed: Double): Double {
        val peak = max(partial.peak, FLOOR * 2)
        if (partial.shape == Shape.BELL) {
            val attack = 0.015
            return if (elapsed < attack) ramp(FLOOR, peak, elapsed / attack)
            else ramp(peak, FLOOR, ((elapsed - attack) / (partial.length - attack)).coerceIn(0.0, 1.0))
        }
        val attack = 0.02
        val hold = max(0.03, partial.length - 0.08)
        return when {
            elapsed < attack -> ramp(FLOOR, peak, elapsed / attack)
            elapsed < hold -> peak
            else -> ramp(peak, FLOOR, ((elapsed - hold) / max(1e-4, partial.length - hold)).coerceIn(0.0, 1.0))
        }
    }

    private fun ramp(from: Double, to: Double, progress: Double) = from * exp(ln(to / from) * progress)

    private fun playPcm(pcm: ShortArray) {
        stopTrack()
        val bytes = pcm.size * 2
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val format = AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(RATE)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build()
        val next = AudioTrack.Builder()
            .setAudioAttributes(attributes)
            .setAudioFormat(format)
            .setBufferSizeInBytes(bytes)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()

        next.write(pcm, 0, pcm.size)
        next.setVolume(AudioTrack.getMaxVolume())
        next.play()
        track = next

        /* Static tracks hold their buffer until released; let it finish, then let go. */
        val millis = (pcm.size * 1000L / RATE) + 250L
        handler.postDelayed({ if (track === next) stopTrack() }, millis)
    }

    private fun stopTrack() {
        val current = track ?: return
        track = null
        try {
            if (current.state == AudioTrack.STATE_INITIALIZED) current.stop()
        } catch (_: IllegalStateException) {
        } finally {
            current.release()
        }
    }
}
