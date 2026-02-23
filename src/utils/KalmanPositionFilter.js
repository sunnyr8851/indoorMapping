/**
 * 2D Kalman Filter for Indoor Position Smoothing
 * 
 * Provides optimal position estimation by combining:
 * - WiFi fingerprint measurements (noisy)
 * - Motion prediction (based on velocity)
 * 
 * State: [x, y, vx, vy] (position + velocity)
 * Measurement: [x, y] from WiFi fingerprint
 */

class KalmanPositionFilter {
  constructor(options = {}) {
    // Process noise (how much we expect position to change between scans)
    // Lower = smoother but slower response
    // Higher = responsive but noisier
    this.processNoise = options.processNoise || 0.3;
    
    // Measurement noise (how noisy WiFi readings are)
    // Lower = trust WiFi more
    // Higher = trust prediction more
    this.measurementNoise = options.measurementNoise || 2.0;
    
    // Time step between measurements (seconds)
    this.dt = options.dt || 1.0;
    
    // State: [x, y, vx, vy]
    this.state = null;
    
    // Covariance matrix (uncertainty) - 4x4 for [x, y, vx, vy]
    this.P = null;
    
    // Is filter initialized?
    this.initialized = false;
    
    // History for debugging
    this.history = [];
    this.maxHistorySize = 20;
  }

  /**
   * Initialize filter with first measurement
   * @param {number} x - Initial x position
   * @param {number} y - Initial y position
   */
  initialize(x, y) {
    // Initial state: position known, velocity unknown (0)
    this.state = [x, y, 0, 0];
    
    // Initial uncertainty: low for position, high for velocity
    this.P = [
      [1, 0, 0, 0],   // x variance
      [0, 1, 0, 0],   // y variance
      [0, 0, 10, 0],  // vx variance (high - we don't know velocity)
      [0, 0, 0, 10]   // vy variance
    ];
    
    this.initialized = true;
    this.addToHistory('initialize', { x, y });
    console.log(`[Kalman] Initialized at (${x}, ${y})`);
  }

  /**
   * Predict step: Estimate where user should be based on motion model
   * Called internally before each update
   */
  predict() {
    if (!this.initialized) return;

    const dt = this.dt;
    const [x, y, vx, vy] = this.state;

    // State transition: new_pos = old_pos + velocity * dt
    // Assumes constant velocity model
    this.state = [
      x + vx * dt,  // x_new = x + vx * dt
      y + vy * dt,  // y_new = y + vy * dt
      vx * 0.9,     // velocity decay (friction) - prevents runaway
      vy * 0.9
    ];

    // Update covariance matrix (increase uncertainty due to process noise)
    const q = this.processNoise;
    const dt2 = dt * dt;
    
    // Simplified covariance update
    this.P[0][0] += q + this.P[2][2] * dt2;  // x uncertainty increases
    this.P[1][1] += q + this.P[3][3] * dt2;  // y uncertainty increases
    this.P[2][2] += q * 0.5;                  // vx uncertainty increases
    this.P[3][3] += q * 0.5;                  // vy uncertainty increases

    // Clamp covariance to prevent numerical instability
    this.P[0][0] = Math.min(this.P[0][0], 100);
    this.P[1][1] = Math.min(this.P[1][1], 100);
    this.P[2][2] = Math.min(this.P[2][2], 50);
    this.P[3][3] = Math.min(this.P[3][3], 50);
  }

  /**
   * Update step: Correct prediction with WiFi measurement
   * @param {number} measuredX - X position from WiFi fingerprint
   * @param {number} measuredY - Y position from WiFi fingerprint
   * @param {number} rssiConfidence - Confidence in measurement (0-1), based on RSSI distance
   * @returns {Object} Filtered position with metadata
   */
  update(measuredX, measuredY, rssiConfidence = 1.0) {
    // First measurement - initialize
    if (!this.initialized) {
      this.initialize(measuredX, measuredY);
      return {
        x: measuredX,
        y: measuredY,
        rawX: measuredX,
        rawY: measuredY,
        velocityX: 0,
        velocityY: 0,
        confidence: 1.0,
        kalmanGain: 1.0,
        isInitial: true
      };
    }

    // Save pre-update state for logging
    const prePredictState = [...this.state];

    // Step 1: Predict
    this.predict();
    
    const predictedX = this.state[0];
    const predictedY = this.state[1];

    // Step 2: Calculate Kalman Gain
    // Higher gain = trust measurement more
    // Lower gain = trust prediction more
    
    // Adjust measurement noise based on RSSI confidence
    // Low confidence (high RSSI distance) = high measurement noise
    const adjustedR = this.measurementNoise / Math.max(rssiConfidence, 0.1);
    
    // Kalman gain for x and y
    const K_x = this.P[0][0] / (this.P[0][0] + adjustedR);
    const K_y = this.P[1][1] / (this.P[1][1] + adjustedR);

    // Step 3: Calculate innovation (measurement residual)
    const innovationX = measuredX - predictedX;
    const innovationY = measuredY - predictedY;

    // Step 4: Update state with weighted combination
    this.state[0] = predictedX + K_x * innovationX;
    this.state[1] = predictedY + K_y * innovationY;
    
    // Update velocity estimate based on position change
    const newVx = (this.state[0] - prePredictState[0]) / this.dt;
    const newVy = (this.state[1] - prePredictState[1]) / this.dt;
    
    // Blend new velocity with old (smooth velocity changes)
    this.state[2] = 0.7 * this.state[2] + 0.3 * newVx;
    this.state[3] = 0.7 * this.state[3] + 0.3 * newVy;

    // Step 5: Update covariance (reduce uncertainty after measurement)
    this.P[0][0] *= (1 - K_x);
    this.P[1][1] *= (1 - K_y);
    
    // Ensure minimum uncertainty
    this.P[0][0] = Math.max(this.P[0][0], 0.1);
    this.P[1][1] = Math.max(this.P[1][1], 0.1);

    // Calculate overall confidence (inverse of uncertainty)
    const uncertainty = (this.P[0][0] + this.P[1][1]) / 2;
    const confidence = Math.max(0, Math.min(1, 1 - uncertainty / 10));

    const result = {
      x: Math.round(this.state[0]),
      y: Math.round(this.state[1]),
      rawX: this.state[0],
      rawY: this.state[1],
      measuredX: measuredX,
      measuredY: measuredY,
      predictedX: predictedX,
      predictedY: predictedY,
      velocityX: this.state[2],
      velocityY: this.state[3],
      confidence: confidence,
      kalmanGainX: K_x,
      kalmanGainY: K_y,
      innovationX: innovationX,
      innovationY: innovationY,
      rssiConfidence: rssiConfidence
    };

    this.addToHistory('update', result);
    
    console.log(
      `[Kalman] Measured:(${measuredX},${measuredY}) → ` +
      `Predicted:(${predictedX.toFixed(1)},${predictedY.toFixed(1)}) → ` +
      `Filtered:(${result.x},${result.y}) | ` +
      `Gain:${K_x.toFixed(2)} | Conf:${confidence.toFixed(2)}`
    );
    
    return result;
  }

  /**
   * Get current estimated position without new measurement
   * Useful for interpolation between scans
   */
  getPosition() {
    if (!this.initialized) return null;
    
    return {
      x: Math.round(this.state[0]),
      y: Math.round(this.state[1]),
      rawX: this.state[0],
      rawY: this.state[1],
      velocityX: this.state[2],
      velocityY: this.state[3],
      uncertainty: (this.P[0][0] + this.P[1][1]) / 2
    };
  }

  /**
   * Get predicted next position (without measurement)
   * Useful for showing where user might be going
   */
  getPredictedPosition(stepsAhead = 1) {
    if (!this.initialized) return null;
    
    const dt = this.dt * stepsAhead;
    return {
      x: Math.round(this.state[0] + this.state[2] * dt),
      y: Math.round(this.state[1] + this.state[3] * dt),
      velocityX: this.state[2],
      velocityY: this.state[3]
    };
  }

  /**
   * Reset the filter - call when starting new tracking session
   */
  reset() {
    this.state = null;
    this.P = null;
    this.initialized = false;
    this.history = [];
    console.log('[Kalman] Filter reset');
  }

  /**
   * Set time step between measurements
   * @param {number} seconds - Time between scans
   */
  setTimeStep(seconds) {
    this.dt = seconds;
    console.log(`[Kalman] Time step set to ${seconds}s`);
  }

  /**
   * Update filter parameters
   */
  setParameters(options = {}) {
    if (options.processNoise !== undefined) {
      this.processNoise = options.processNoise;
    }
    if (options.measurementNoise !== undefined) {
      this.measurementNoise = options.measurementNoise;
    }
    if (options.dt !== undefined) {
      this.dt = options.dt;
    }
    console.log(`[Kalman] Parameters updated: processNoise=${this.processNoise}, measurementNoise=${this.measurementNoise}`);
  }

  /**
   * Add entry to history for debugging
   */
  addToHistory(type, data) {
    this.history.push({
      type,
      timestamp: Date.now(),
      data: { ...data }
    });
    
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  /**
   * Get filter statistics for debugging
   */
  getStats() {
    return {
      initialized: this.initialized,
      state: this.state ? [...this.state] : null,
      covariance: this.P ? this.P.map(row => [...row]) : null,
      parameters: {
        processNoise: this.processNoise,
        measurementNoise: this.measurementNoise,
        dt: this.dt
      },
      historyLength: this.history.length
    };
  }
}

// ============================================
// SINGLETON INSTANCE MANAGEMENT
// ============================================

let kalmanFilterInstance = null;

/**
 * Get or create Kalman filter instance
 * @param {Object} options - Filter options
 * @returns {KalmanPositionFilter}
 */
export function getKalmanFilter(options = {}) {
  if (!kalmanFilterInstance) {
    kalmanFilterInstance = new KalmanPositionFilter(options);
  } else if (Object.keys(options).length > 0) {
    kalmanFilterInstance.setParameters(options);
  }
  return kalmanFilterInstance;
}

/**
 * Reset Kalman filter - call when starting new tracking session
 */
export function resetKalmanFilter() {
  if (kalmanFilterInstance) {
    kalmanFilterInstance.reset();
  }
}

/**
 * Get Kalman filter statistics for debugging
 */
export function getKalmanStats() {
  if (kalmanFilterInstance) {
    return kalmanFilterInstance.getStats();
  }
  return null;
}

export default KalmanPositionFilter;
