# Environmental Noise / Decibel Meter

Real-time sound-level (dB) monitor built with **PyQtGraph + PyQt5 + sounddevice**.
Records from your laptop microphone and visualises environmental noise live.
Architecture follows the UAO_SpO2_Sim pattern (QTimer-driven redraws, deque ring
buffers, start/stop control) so it ports cleanly to a Raspberry Pi Pico 2 later.

## Install

```bash
pip install numpy pyqtgraph PyQt5 sounddevice
```

`sounddevice` needs PortAudio:
- **macOS:** `brew install portaudio`
- **Linux:** `sudo apt install libportaudio2`
- **Windows:** bundled with the pip wheel

## Run

```bash
python noise_meter.py
```

Pick your input device, hit **Start**, and watch the level. **Stop** halts the
stream; **Reset** clears the session stats.

## What you get

- **Headline dB readout** colour-coded by loudness band (green/blue/orange/red).
- **dB-over-time** trace with a decaying peak-hold line.
- **Live waveform** view of the raw mic signal.
- **Session stats:** min, max, peak, and **Leq** (energy-averaged level — the
  correct way to average decibels, not an arithmetic mean).
- **Calibration offset** so you can align readings to a reference SPL app.

## Calibrating (important)

A laptop mic is *not* a calibrated instrument, so absolute numbers are estimates
(dBFS + offset), not certified dB SPL. To calibrate:

1. Put a phone SPL-meter app next to your laptop mic in a steady-noise spot.
2. Adjust the **Calibration offset** until this app matches the phone.
3. Note the offset — it's mic-specific.

For street-noise work, true accuracy needs a calibrated mic, but relative trends
(quiet vs busy, day vs night) are perfectly meaningful uncalibrated.

## Roadmap to the Raspberry Pi Pico 2

The producer/consumer split is already in place:

- **Now:** `AudioInput` callback thread → `queue.Queue` → Qt timer drains it.
- **Next:** replace `AudioInput` with a `SerialInput` class that reads noise
  (and temp/humidity/etc.) frames the Pico 2 streams over USB-serial, pushing
  them into the same queue. The GUI, plotting, and stats code stay unchanged.

Natural extensions when you get there: A-weighting filter for IEC-61672-style
readings, FFT/spectrogram panel, and CSV/Parquet logging for long-term street
monitoring.
