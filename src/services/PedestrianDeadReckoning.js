/**
 * Pedestrian Dead Reckoning (PDR) Service
 * 
 * Uses smartphone sensors to track user position:
 * - Accelerometer: Step detection (peak detection algorithm)
 * - Gyroscope: Relative heading changes (integrated over time)
 * - Magnetometer: Absolute compass heading (noisy indoors but useful for calibration)
 * 
 * Position update formula:
 *   x += stepLength * sin(heading)
 *   y -= stepLength * cos(heading)  // y increases downward in SVG
 * 
 * LIMITATIONS (as noted in the research):
 * - Drift accumulates over time (no absolute reference)
 * - Magnetometer is unreliable indoors (metal, electronics interference)
 * - Best used for short-term tracking or combined with other positioning methods
 */

import {
  accelerometer,
  gyroscope,
  magnetometer,
  setUpdateIntervalForType,
  SensorTypes,
} from 'react-native-sensors';

// Default configuration
const DEFAULT_CONFIG = {
  stepLength: 0.65,              // Average step length in meters (calibrate per user)
  pixelsPerMeter: 10,            // Map scale: pixels per real-world meter
  stepThreshold: 1.2,            // Acceleration threshold for step detection (g)
  stepCooldownMs: 300,           // Minimum time between steps (prevents double counting)
  sensorUpdateMs: 20,            // Sensor sampling rate (50Hz)
  gyroWeight: 0.98,              // Complementary filter: gyro weight (0-1)
  lowPassAlpha: 0.3,             // Low-pass filter for accelerometer smoothing
};

class PedestrianDeadReckoning {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Position state (in map pixel coordinates)
    this.position = { x: 0, y: 0 };
    
    // Heading in radians (0 = North/up, clockwise positive)
    this.heading = 0;
    
    // Step detection state
    this.lastStepTime = 0;
    this.stepCount = 0;
    this.totalDistance = 0;
    
    // Sensor data buffers
    this.accelMagnitude = 0;
    this.lastAccelMagnitude = 0;
    this.accelFiltered = { x: 0, y: 0, z: 0 };
    
    // Gyroscope integration
    this.lastGyroTimestamp = null;
    
    // Magnetometer heading (for reference/calibration)
    this.magneticHeading = 0;
    
    // Subscriptions
    this.subscriptions = [];
    
    // Callbacks
    this.onPositionUpdate = null;
    this.onStepDetected = null;
    this.onHeadingUpdate = null;
    
    // Running state
    this.isRunning = false;
  }

  /**
   * Initialize sensor update intervals
   */
  _initSensorIntervals() {
    const interval = this.config.sensorUpdateMs;
    setUpdateIntervalForType(SensorTypes.accelerometer, interval);
    setUpdateIntervalForType(SensorTypes.gyroscope, interval);
    setUpdateIntervalForType(SensorTypes.magnetometer, interval);
  }

  /**
   * Low-pass filter to smooth accelerometer data
   */
  _lowPassFilter(current, previous, alpha) {
    return {
      x: alpha * current.x + (1 - alpha) * previous.x,
      y: alpha * current.y + (1 - alpha) * previous.y,
      z: alpha * current.z + (1 - alpha) * previous.z,
    };
  }

  /**
   * Calculate acceleration magnitude (for step detection)
   */
  _calculateMagnitude(data) {
    return Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
  }

  /**
   * Process accelerometer data for step detection
   * Uses peak detection on filtered acceleration magnitude
   */
  _processAccelerometer(data) {
    // Apply low-pass filter
    this.accelFiltered = this._lowPassFilter(
      data,
      this.accelFiltered,
      this.config.lowPassAlpha
    );
    
    // Calculate magnitude (in g, ~9.8 when stationary)
    const magnitude = this._calculateMagnitude(this.accelFiltered);
    
    // Normalize to g (gravity)
    const normalizedMag = magnitude / 9.81;
    
    // Peak detection for step
    const now = Date.now();
    const timeSinceLastStep = now - this.lastStepTime;
    
    // Detect step: magnitude crosses threshold going down (peak)
    if (
      this.lastAccelMagnitude > this.config.stepThreshold &&
      normalizedMag <= this.config.stepThreshold &&
      timeSinceLastStep > this.config.stepCooldownMs
    ) {
      this._onStepDetected();
      this.lastStepTime = now;
    }
    
    this.lastAccelMagnitude = normalizedMag;
  }

  /**
   * Handle detected step - update position
   */
  _onStepDetected() {
    this.stepCount++;
    
    // Calculate displacement in map coordinates
    // heading: 0 = up (negative y), 90 = right (positive x)
    const stepPixels = this.config.stepLength * this.config.pixelsPerMeter;
    const dx = stepPixels * Math.sin(this.heading);
    const dy = -stepPixels * Math.cos(this.heading); // Negative because y increases downward
    
    this.position.x += dx;
    this.position.y += dy;
    this.totalDistance += this.config.stepLength;
    
    // Notify callback
    if (this.onStepDetected) {
      this.onStepDetected({
        stepCount: this.stepCount,
        totalDistance: this.totalDistance,
        position: { ...this.position },
        heading: this.heading,
      });
    }
    
    this._notifyPositionUpdate();
  }

  /**
   * Process gyroscope data for heading changes
   * Integrates angular velocity over time
   */
  _processGyroscope(data, timestamp) {
    if (this.lastGyroTimestamp === null) {
      this.lastGyroTimestamp = timestamp;
      return;
    }
    
    // Calculate delta time in seconds
    const dt = (timestamp - this.lastGyroTimestamp) / 1000;
    this.lastGyroTimestamp = timestamp;
    
    // Integrate z-axis rotation (yaw) - phone held vertically
    // data.z is angular velocity in rad/s around vertical axis
    const deltaHeading = data.z * dt;
    
    this.heading += deltaHeading;
    
    // Normalize heading to [0, 2π]
    while (this.heading < 0) this.heading += 2 * Math.PI;
    while (this.heading >= 2 * Math.PI) this.heading -= 2 * Math.PI;
    
    if (this.onHeadingUpdate) {
      this.onHeadingUpdate({
        heading: this.heading,
        headingDegrees: (this.heading * 180) / Math.PI,
      });
    }
  }

  /**
   * Process magnetometer data for compass heading
   * Used for calibration and drift correction
   */
  _processMagnetometer(data) {
    // Calculate magnetic heading from x and y components
    // Assumes phone is held flat or vertically
    let heading = Math.atan2(data.y, data.x);
    
    // Convert to [0, 2π]
    if (heading < 0) heading += 2 * Math.PI;
    
    this.magneticHeading = heading;
  }

  /**
   * Notify position update callback
   */
  _notifyPositionUpdate() {
    if (this.onPositionUpdate) {
      this.onPositionUpdate({
        position: { ...this.position },
        heading: this.heading,
        headingDegrees: (this.heading * 180) / Math.PI,
        stepCount: this.stepCount,
        totalDistance: this.totalDistance,
      });
    }
  }

  /**
   * Start PDR tracking
   * @param {Object} initialPosition - Starting position { x, y } in map coordinates
   * @param {number} initialHeading - Starting heading in radians (0 = up/north)
   */
  start(initialPosition = { x: 0, y: 0 }, initialHeading = 0) {
    if (this.isRunning) {
      console.warn('PDR already running');
      return;
    }

    this._initSensorIntervals();
    
    // Set initial state
    this.position = { ...initialPosition };
    this.heading = initialHeading;
    this.stepCount = 0;
    this.totalDistance = 0;
    this.lastStepTime = 0;
    this.lastGyroTimestamp = null;
    
    // Subscribe to accelerometer
    const accelSub = accelerometer.subscribe({
      next: (data) => this._processAccelerometer(data),
      error: (err) => console.error('Accelerometer error:', err),
    });
    this.subscriptions.push(accelSub);
    
    // Subscribe to gyroscope
    const gyroSub = gyroscope.subscribe({
      next: (data) => this._processGyroscope(data, Date.now()),
      error: (err) => console.error('Gyroscope error:', err),
    });
    this.subscriptions.push(gyroSub);
    
    // Subscribe to magnetometer
    const magSub = magnetometer.subscribe({
      next: (data) => this._processMagnetometer(data),
      error: (err) => console.error('Magnetometer error:', err),
    });
    this.subscriptions.push(magSub);
    
    this.isRunning = true;
    console.log('PDR started at position:', this.position, 'heading:', this.heading);
    
    // Initial position update
    this._notifyPositionUpdate();
  }

  /**
   * Stop PDR tracking
   */
  stop() {
    this.subscriptions.forEach(sub => sub.unsubscribe());
    this.subscriptions = [];
    this.isRunning = false;
    console.log('PDR stopped');
  }

  /**
   * Calibrate heading using magnetometer
   * Call when user is facing a known direction
   */
  calibrateHeading(knownHeadingRadians = null) {
    if (knownHeadingRadians !== null) {
      this.heading = knownHeadingRadians;
    } else {
      // Use current magnetic heading
      this.heading = this.magneticHeading;
    }
    console.log('Heading calibrated to:', (this.heading * 180) / Math.PI, 'degrees');
    this._notifyPositionUpdate();
  }

  /**
   * Set position manually (e.g., when user taps on map)
   */
  setPosition(x, y) {
    this.position = { x, y };
    this._notifyPositionUpdate();
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }

  /**
   * Get current state
   */
  getState() {
    return {
      position: { ...this.position },
      heading: this.heading,
      headingDegrees: (this.heading * 180) / Math.PI,
      magneticHeading: this.magneticHeading,
      magneticHeadingDegrees: (this.magneticHeading * 180) / Math.PI,
      stepCount: this.stepCount,
      totalDistance: this.totalDistance,
      isRunning: this.isRunning,
      config: { ...this.config },
    };
  }
}

// Export singleton instance
export const pdrService = new PedestrianDeadReckoning();

// Export class for custom instances
export default PedestrianDeadReckoning;
