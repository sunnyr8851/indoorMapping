/**
 * React Hook for Pedestrian Dead Reckoning
 * 
 * Provides easy integration of PDR tracking into React Native components.
 * Manages sensor subscriptions and provides real-time position/heading updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { pdrService } from '../services/PedestrianDeadReckoning';

/**
 * Hook to use PDR for indoor positioning
 * 
 * @param {Object} options
 * @param {Object} options.initialPosition - Starting position { x, y }
 * @param {number} options.initialHeading - Starting heading in degrees (0 = up/north)
 * @param {number} options.stepLength - Step length in meters
 * @param {number} options.pixelsPerMeter - Map scale factor
 * @param {boolean} options.autoStart - Whether to start tracking automatically
 * 
 * @returns {Object} PDR state and controls
 */
export function usePDR(options = {}) {
  const {
    initialPosition = { x: 200, y: 200 },
    initialHeading = 0, // degrees
    stepLength = 0.65,
    pixelsPerMeter = 10,
    autoStart = false,
  } = options;

  // State
  const [position, setPosition] = useState(initialPosition);
  const [heading, setHeading] = useState(initialHeading);
  const [headingDegrees, setHeadingDegrees] = useState(initialHeading);
  const [stepCount, setStepCount] = useState(0);
  const [totalDistance, setTotalDistance] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [lastStep, setLastStep] = useState(null);

  // Ref to track if component is mounted
  const isMounted = useRef(true);

  // Update PDR config when options change
  useEffect(() => {
    pdrService.updateConfig({
      stepLength,
      pixelsPerMeter,
    });
  }, [stepLength, pixelsPerMeter]);

  // Set up callbacks
  useEffect(() => {
    isMounted.current = true;

    // Position update callback
    pdrService.onPositionUpdate = (data) => {
      if (!isMounted.current) return;
      setPosition(data.position);
      setHeading(data.heading);
      setHeadingDegrees(data.headingDegrees);
      setStepCount(data.stepCount);
      setTotalDistance(data.totalDistance);
    };

    // Step detected callback
    pdrService.onStepDetected = (data) => {
      if (!isMounted.current) return;
      setLastStep({
        timestamp: Date.now(),
        stepCount: data.stepCount,
        position: data.position,
      });
    };

    return () => {
      isMounted.current = false;
      pdrService.onPositionUpdate = null;
      pdrService.onStepDetected = null;
    };
  }, []);

  // Auto-start if specified
  useEffect(() => {
    if (autoStart && !isRunning) {
      start();
    }
    
    return () => {
      if (isRunning) {
        pdrService.stop();
      }
    };
  }, [autoStart]);

  // Start tracking
  const start = useCallback((customPosition = null, customHeading = null) => {
    const startPos = customPosition || initialPosition;
    const startHeading = ((customHeading ?? initialHeading) * Math.PI) / 180; // Convert to radians
    
    pdrService.start(startPos, startHeading);
    setIsRunning(true);
    setPosition(startPos);
    setHeading(startHeading);
    setHeadingDegrees(customHeading ?? initialHeading);
    setStepCount(0);
    setTotalDistance(0);
  }, [initialPosition, initialHeading]);

  // Stop tracking
  const stop = useCallback(() => {
    pdrService.stop();
    setIsRunning(false);
  }, []);

  // Reset position (without stopping)
  const resetPosition = useCallback((newPosition, newHeadingDegrees = null) => {
    pdrService.setPosition(newPosition.x, newPosition.y);
    if (newHeadingDegrees !== null) {
      pdrService.calibrateHeading((newHeadingDegrees * Math.PI) / 180);
    }
    setPosition(newPosition);
    setStepCount(0);
    setTotalDistance(0);
  }, []);

  // Calibrate heading to a known direction
  const calibrateHeading = useCallback((degrees) => {
    const radians = (degrees * Math.PI) / 180;
    pdrService.calibrateHeading(radians);
    setHeading(radians);
    setHeadingDegrees(degrees);
  }, []);

  // Use magnetic compass for heading
  const calibrateWithCompass = useCallback(() => {
    pdrService.calibrateHeading(null);
    const state = pdrService.getState();
    setHeading(state.heading);
    setHeadingDegrees(state.headingDegrees);
  }, []);

  // Get full state
  const getState = useCallback(() => {
    return pdrService.getState();
  }, []);

  return {
    // Position & heading
    position,
    heading,
    headingDegrees,
    
    // Step tracking
    stepCount,
    totalDistance,
    lastStep,
    
    // State
    isRunning,
    
    // Controls
    start,
    stop,
    resetPosition,
    calibrateHeading,
    calibrateWithCompass,
    getState,
  };
}

export default usePDR;
