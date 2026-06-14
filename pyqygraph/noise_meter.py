"""
Environmental Noise / Decibel Meter - Real-time SPL Monitor
-----------------------------------------------------------
A Scientific Graphics & GUI application that records audio from the laptop
microphone and visualises the sound pressure level (dB) of the environment
in real time using PyQtGraph.

Designed as a learning scaffold: the same timer-driven plotting + ring-buffer
architecture will later be reused to ingest noise (and other environmental
data) streamed from a Raspberry Pi Pico 2.

Architecture mirrors the UAO_SpO2_Sim project (Kevin Machado Gamboa):
    - QTimer drives periodic plot redraws
    - collections.deque used as fixed-length ring buffers
    - start()/stop() control flow with UI enable/disable
    - sounddevice replaces the PCF8591 ADC as the data source

Author: built with Claude
Requires: pip install numpy pyqtgraph PyQt5 sounddevice
-----------------------------------------------------------

ON CALIBRATION
--------------
A laptop microphone is NOT a calibrated measurement instrument, so the absolute
dB numbers here are dBFS-derived estimates, not true dB SPL. A CAL_OFFSET lets
you align readings against a reference (e.g. a phone SPL-meter app). See the
constants block below. Treat values as relative/indicative until calibrated.
"""

import sys
import queue

import numpy as np
import pyqtgraph as pg
import sounddevice as sd
from collections import deque

from PyQt5 import QtCore, QtWidgets
from PyQt5.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout, QGridLayout,
    QPushButton, QLabel, QComboBox, QDoubleSpinBox, QGroupBox, QFrame
)

# -----------------------------------------------------------------------------
#                              Configuration
# -----------------------------------------------------------------------------
SAMPLE_RATE      = 44100      # Hz - audio sampling rate
BLOCK_SIZE       = 2048       # samples per audio callback (~46 ms @ 44.1 kHz)
CHANNELS         = 1          # mono
N_SAMPLES        = 300        # points kept in the dB-history plot (ring buffer)
PLOT_UPDATE_TIME = 50         # ms - GUI redraw interval (20 FPS)
WAVE_SAMPLES     = 2048       # samples shown in the live waveform view

# dB(FS) reference. 1.0 == full-scale. We report dB relative to full scale and
# add CAL_OFFSET so the figure approximates dB SPL after calibration.
EPS              = 1e-10      # avoids log10(0)
DEFAULT_CAL_OFFSET = 94.0     # rough starting offset; tune against a real meter

# MATLAB-style palette, consistent with the SpO2 project
COLOR_WAVE   = '#0072bd'   # blue  - waveform
COLOR_DB     = '#d95319'   # orange - dB trace
COLOR_PEAK   = '#bd0000'   # red   - peak hold
COLOR_GRID   = '#404040'


# -----------------------------------------------------------------------------
#                       Audio Acquisition (data source)
# -----------------------------------------------------------------------------
class AudioInput:
    """
    Thin wrapper around a sounddevice InputStream.

    The audio callback runs on a separate high-priority thread and must NOT
    touch Qt widgets, so it just drops raw blocks into a thread-safe queue.
    The GUI timer drains that queue. This is the same producer/consumer split
    you'll want when a Pico 2 streams bytes over serial/USB later: the read
    thread fills a queue, the Qt timer empties it.
    """

    def __init__(self, device=None, samplerate=SAMPLE_RATE,
                 blocksize=BLOCK_SIZE, channels=CHANNELS):
        self.device = device
        self.samplerate = samplerate
        self.blocksize = blocksize
        self.channels = channels
        self.q = queue.Queue()
        self.stream = None

    def _callback(self, indata, frames, time_info, status):
        if status:
            # Over/underflows printed for debugging; not fatal
            print(f"[audio] {status}", file=sys.stderr)
        # Copy: indata buffer is reused by PortAudio after the callback returns
        self.q.put(indata[:, 0].copy())

    def start(self):
        self.stream = sd.InputStream(
            device=self.device,
            channels=self.channels,
            samplerate=self.samplerate,
            blocksize=self.blocksize,
            callback=self._callback,
        )
        self.stream.start()

    def stop(self):
        if self.stream is not None:
            self.stream.stop()
            self.stream.close()
            self.stream = None
        # Drain anything left over
        with self.q.mutex:
            self.q.queue.clear()

    @staticmethod
    def list_input_devices():
        """Return [(index, name), ...] for devices that can record."""
        devices = sd.query_devices()
        out = []
        for i, d in enumerate(devices):
            if d.get('max_input_channels', 0) > 0:
                out.append((i, d['name']))
        return out


# -----------------------------------------------------------------------------
#                                Main Window
# -----------------------------------------------------------------------------
class mainWindow(QMainWindow):

    def __init__(self):
        QMainWindow.__init__(self)
        self.setWindowTitle("Environmental Noise Meter  -  dB SPL Monitor")
        self.resize(1100, 720)

        # ---------------------------------------------------------- #
        #               Shared variables, initial values
        # ---------------------------------------------------------- #
        self.db_history   = deque([], maxlen=N_SAMPLES)
        self.time_history = deque([], maxlen=N_SAMPLES)
        self.peak_history = deque([], maxlen=N_SAMPLES)

        self.audio = None
        self.cal_offset = DEFAULT_CAL_OFFSET
        self.sample_index = 0
        self.peak_hold = -np.inf
        self.db_min_session = np.inf
        self.db_max_session = -np.inf

        # Exponential smoothing for a steadier "needle" reading (~fast weighting)
        self.db_smoothed = None
        self.smoothing = 0.3   # 0 = no smoothing, ->1 = very sluggish

        self._timer_plot = None

        # ---------------------------------------------------------- #
        #                Build & configure the GUI
        # ---------------------------------------------------------- #
        self._build_ui()
        self._configure_plot()
        self._configure_timers()
        self._populate_devices()
        self._enable_ui(True)

    ## -----------------------------------
    ##           UI Construction
    ## -----------------------------------
    def _build_ui(self):
        central = QWidget()
        self.setCentralWidget(central)
        root = QHBoxLayout(central)

        # ----- Left control / readout column -----
        left = QVBoxLayout()
        left.setSpacing(12)

        title = QLabel("NOISE METER")
        title.setStyleSheet("color:#d95319; font-size:22px; font-weight:bold;")
        left.addWidget(title)

        # Big live dB number
        self.lblDb = QLabel("--.-")
        self.lblDb.setAlignment(QtCore.Qt.AlignCenter)
        self.lblDb.setStyleSheet(
            "color:#0072bd; font-size:64px; font-weight:bold;")
        left.addWidget(self.lblDb)

        unit = QLabel("dB SPL (estimated)")
        unit.setAlignment(QtCore.Qt.AlignCenter)
        unit.setStyleSheet("color:#aaaaaa; font-size:13px;")
        left.addWidget(unit)

        # Stats group (min / max / peak / Leq)
        stats = QGroupBox("Session statistics")
        sgrid = QGridLayout(stats)
        self.lblMin  = QLabel("--")
        self.lblMax  = QLabel("--")
        self.lblPeak = QLabel("--")
        self.lblLeq  = QLabel("--")
        for r, (name, w) in enumerate([
            ("Min dB",  self.lblMin),
            ("Max dB",  self.lblMax),
            ("Peak dB", self.lblPeak),
            ("Leq (avg)", self.lblLeq),
        ]):
            cap = QLabel(name)
            cap.setStyleSheet("color:#cccccc;")
            w.setStyleSheet("color:#ffffff; font-weight:bold;")
            sgrid.addWidget(cap, r, 0)
            sgrid.addWidget(w,   r, 1)
        left.addWidget(stats)

        # Device selector
        devbox = QGroupBox("Input device")
        dlay = QVBoxLayout(devbox)
        self.deviceCombo = QComboBox()
        dlay.addWidget(self.deviceCombo)
        left.addWidget(devbox)

        # Calibration
        calbox = QGroupBox("Calibration offset (dB)")
        clay = QVBoxLayout(calbox)
        self.calSpin = QDoubleSpinBox()
        self.calSpin.setRange(0.0, 140.0)
        self.calSpin.setSingleStep(0.5)
        self.calSpin.setValue(DEFAULT_CAL_OFFSET)
        self.calSpin.valueChanged.connect(self._on_cal_change)
        clay.addWidget(self.calSpin)
        calhint = QLabel("Match this to a reference SPL app, then note the value.")
        calhint.setWordWrap(True)
        calhint.setStyleSheet("color:#888888; font-size:11px;")
        clay.addWidget(calhint)
        left.addWidget(calbox)

        # Start / Stop / Reset
        btnrow = QHBoxLayout()
        self.startButton = QPushButton("Start")
        self.stopButton  = QPushButton("Stop")
        self.resetButton = QPushButton("Reset")
        for b, col in [(self.startButton, "#1a7a1a"),
                       (self.stopButton,  "#7a1a1a"),
                       (self.resetButton, "#555555")]:
            b.setStyleSheet(
                f"QPushButton{{background:{col}; color:white; font-weight:bold;"
                f" padding:10px; border-radius:4px;}}"
                f"QPushButton:disabled{{background:#2b2b2b; color:#666;}}")
            btnrow.addWidget(b)
        self.startButton.clicked.connect(self.start)
        self.stopButton.clicked.connect(self.stop)
        self.resetButton.clicked.connect(self.reset_stats)
        left.addLayout(btnrow)

        left.addStretch(1)

        # Reference table so users can interpret the numbers
        ref = QLabel(
            "Reference levels:\n"
            "  30 dB  quiet room\n"
            "  40 dB  library\n"
            "  60 dB  conversation\n"
            "  70 dB  busy street / traffic\n"
            "  85 dB  hearing-risk threshold\n"
            " 100 dB  motorbike / heavy traffic")
        ref.setStyleSheet("color:#777777; font-size:11px; font-family:monospace;")
        left.addWidget(ref)

        leftWrap = QFrame()
        leftWrap.setLayout(left)
        leftWrap.setFixedWidth(280)
        root.addWidget(leftWrap)

        # ----- Right plotting column -----
        right = QVBoxLayout()

        self.plt_db   = pg.GraphicsLayoutWidget()
        self.plt_wave = pg.GraphicsLayoutWidget()
        right.addWidget(self.plt_db,   stretch=3)
        right.addWidget(self.plt_wave, stretch=2)
        root.addLayout(right, stretch=1)

    ## -----------------------------------
    ##         Plot Configuration
    ## -----------------------------------
    def _configure_plot(self):
        """Configure the PyQtGraph plots (dB-over-time + live waveform)."""
        pg.setConfigOptions(antialias=True)

        # --- dB over time ---
        self.plt_db.setBackground(None)
        self._db_plot = self.plt_db.addPlot(row=0, col=0)
        self._db_plot.setTitle("Sound Level over Time", color='#dddddd', size='11pt')
        self._db_plot.setLabel('bottom', "Samples (time)")
        self._db_plot.setLabel('left', "Level", "dB")
        self._db_plot.showGrid(x=True, y=True, alpha=0.3)
        self._db_plot.setYRange(20, 110)
        self._db_curve   = self._db_plot.plot(pen=pg.mkPen(COLOR_DB, width=2))
        self._peak_curve = self._db_plot.plot(
            pen=pg.mkPen(COLOR_PEAK, width=1, style=QtCore.Qt.DashLine))

        # --- live waveform ---
        self.plt_wave.setBackground(None)
        self._wave_plot = self.plt_wave.addPlot(row=0, col=0)
        self._wave_plot.setTitle("Live Waveform", color='#dddddd', size='11pt')
        self._wave_plot.setLabel('bottom', "Sample")
        self._wave_plot.setLabel('left', "Amplitude")
        self._wave_plot.showGrid(x=False, y=True, alpha=0.3)
        self._wave_plot.setYRange(-1, 1)
        self._wave_curve = self._wave_plot.plot(pen=pg.mkPen(COLOR_WAVE, width=1))

    def _configure_timers(self):
        self._timer_plot = QtCore.QTimer(self)
        self._timer_plot.timeout.connect(self._update_plot)

    def _populate_devices(self):
        self.deviceCombo.clear()
        self._device_map = []
        try:
            for idx, name in AudioInput.list_input_devices():
                self.deviceCombo.addItem(f"[{idx}] {name}")
                self._device_map.append(idx)
        except Exception as e:
            self.deviceCombo.addItem("Default device")
            self._device_map.append(None)
            print(f"[devices] could not enumerate: {e}", file=sys.stderr)

    ## -----------------------------------
    ##          DSP: amplitude -> dB
    ## -----------------------------------
    def _compute_db(self, block):
        """
        Convert a block of float samples (-1..1) into an estimated dB level.

        RMS -> dBFS (20*log10(rms)) -> add calibration offset to approximate SPL.
        A-weighting is intentionally omitted for clarity; it can be added later
        when you move to the Pico 2 and want IEC-61672-style measurements.
        """
        rms = np.sqrt(np.mean(np.square(block)) + EPS)
        db_fs = 20.0 * np.log10(rms + EPS)      # <= 0 dBFS
        return db_fs + self.cal_offset

    ## -----------------------------------
    ##              Plot update
    ## -----------------------------------
    def _update_plot(self):
        """Drain the audio queue, compute dB, and redraw. Driven by QTimer."""
        if self.audio is None:
            return

        latest_block = None
        # Drain all queued blocks; keep the last for the waveform view
        while not self.audio.q.empty():
            block = self.audio.q.get()
            latest_block = block
            db = self._compute_db(block)

            # Exponential smoothing for the headline number
            if self.db_smoothed is None:
                self.db_smoothed = db
            else:
                self.db_smoothed = (self.smoothing * self.db_smoothed
                                    + (1 - self.smoothing) * db)

            # Peak hold (decays slowly)
            self.peak_hold = max(self.peak_hold - 0.05, db)

            # Session stats
            self.db_min_session = min(self.db_min_session, db)
            self.db_max_session = max(self.db_max_session, db)

            self.sample_index += 1
            self.time_history.append(self.sample_index)
            self.db_history.append(db)
            self.peak_history.append(self.peak_hold)

        if latest_block is None:
            return

        # --- update headline readout + stats ---
        self.lblDb.setText(f"{self.db_smoothed:0.1f}")
        self.lblMin.setText(f"{self.db_min_session:0.1f}")
        self.lblMax.setText(f"{self.db_max_session:0.1f}")
        self.lblPeak.setText(f"{self.peak_hold:0.1f}")
        if self.db_history:
            # Energy-correct average (Leq) rather than arithmetic mean of dB
            arr = np.array(self.db_history)
            leq = 10.0 * np.log10(np.mean(np.power(10.0, arr / 10.0)) + EPS)
            self.lblLeq.setText(f"{leq:0.1f}")
            # Colour the headline by loudness band
            self._colour_readout(self.db_smoothed)

        # --- redraw traces ---
        t = list(self.time_history)
        self._db_curve.setData(x=t, y=list(self.db_history))
        self._peak_curve.setData(x=t, y=list(self.peak_history))

        # waveform (sub-sample if the block is large)
        wave = latest_block[:WAVE_SAMPLES]
        self._wave_curve.setData(np.arange(len(wave)), wave)

    def _colour_readout(self, db):
        if db < 50:
            c = "#1aa11a"   # green - quiet
        elif db < 70:
            c = "#0072bd"   # blue  - moderate
        elif db < 85:
            c = "#d95319"   # orange - loud
        else:
            c = "#bd0000"   # red   - hearing risk
        self.lblDb.setStyleSheet(
            f"color:{c}; font-size:64px; font-weight:bold;")

    ## -----------------------------------
    ##           Control flow
    ## -----------------------------------
    def start(self):
        device = None
        if self._device_map:
            device = self._device_map[self.deviceCombo.currentIndex()]
        try:
            self.audio = AudioInput(device=device)
            self.audio.start()
        except Exception as e:
            self._show_error(f"Could not open audio device:\n{e}")
            self.audio = None
            return
        self._enable_ui(False)
        self._timer_plot.start(PLOT_UPDATE_TIME)

    def stop(self):
        if self._timer_plot.isActive():
            self._timer_plot.stop()
        if self.audio is not None:
            self.audio.stop()
            self.audio = None
        self._enable_ui(True)

    def reset_stats(self):
        self.db_history.clear()
        self.time_history.clear()
        self.peak_history.clear()
        self.sample_index = 0
        self.peak_hold = -np.inf
        self.db_min_session = np.inf
        self.db_max_session = -np.inf
        self.db_smoothed = None
        for lbl in (self.lblMin, self.lblMax, self.lblPeak, self.lblLeq):
            lbl.setText("--")
        self.lblDb.setText("--.-")
        self._db_curve.setData([], [])
        self._peak_curve.setData([], [])
        self._wave_curve.setData([], [])

    def _on_cal_change(self, value):
        self.cal_offset = value

    def _enable_ui(self, enabled):
        self.startButton.setEnabled(enabled)
        self.deviceCombo.setEnabled(enabled)
        self.stopButton.setEnabled(not enabled)

    def _show_error(self, msg):
        box = QtWidgets.QMessageBox(self)
        box.setIcon(QtWidgets.QMessageBox.Critical)
        box.setWindowTitle("Audio error")
        box.setText(msg)
        box.exec_()

    def closeEvent(self, event):
        self.stop()
        event.accept()


# -----------------------------------------------------------------------------
#                              App Execution
# -----------------------------------------------------------------------------
def main():
    app = QApplication(sys.argv)
    app.setStyleSheet("""
        QMainWindow, QWidget { background:#1b1b1b; }
        QGroupBox { color:#cccccc; border:1px solid #383838; border-radius:5px;
                    margin-top:8px; padding-top:8px; }
        QGroupBox::title { subcontrol-origin: margin; left:8px; padding:0 4px; }
        QComboBox, QDoubleSpinBox, QSpinBox {
            background:#2b2b2b; color:#eeeeee; border:1px solid #444;
            padding:4px; border-radius:3px; }
        QLabel { color:#dddddd; }
    """)
    w = mainWindow()
    w.show()
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()
