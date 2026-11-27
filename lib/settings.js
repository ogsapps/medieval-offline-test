'use strict';

/**
 * The Royal Decrees — validation and defaults for the Scriptorium's timers.
 * All durations are stored in whole minutes; the clerk converts them to seconds.
 */

const DEFAULT_SETTINGS = Object.freeze({
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  sound: true,
});

const LIMITS = Object.freeze({
  focusMinutes: { min: 1, max: 180, label: 'Study' },
  shortBreakMinutes: { min: 1, max: 60, label: 'Rest' },
  longBreakMinutes: { min: 1, max: 90, label: 'Feast' },
  longBreakEvery: { min: 2, max: 12, label: 'Seals before the Feast' },
});

const MODES = Object.freeze(['focus', 'short', 'long']);

class DecreeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DecreeError';
    this.statusCode = 400;
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate and normalise a settings decree.
 * Unknown keys are ignored; missing keys fall back to the defaults.
 * Throws DecreeError with a medieval message on the first offence.
 */
function validateSettings(input) {
  if (!isPlainObject(input)) {
    throw new DecreeError('The decree must be a scroll of settings, not a blank page.');
  }

  const settings = { ...DEFAULT_SETTINGS };

  for (const [key, { min, max, label }] of Object.entries(LIMITS)) {
    if (input[key] === undefined) continue;
    const value = input[key];
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new DecreeError(`${label} must be a whole number of minutes.`);
    }
    if (value < min || value > max) {
      throw new DecreeError(`${label} must be between ${min} and ${max} minutes.`);
    }
    settings[key] = value;
  }

  for (const key of ['autoStartBreaks', 'autoStartFocus', 'sound']) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean') {
      throw new DecreeError(`The setting “${key}” must be true or false, good scribe.`);
    }
    settings[key] = input[key];
  }

  return settings;
}

function validateSession(input) {
  if (!isPlainObject(input)) {
    throw new DecreeError('A ledger entry must be a scroll, not a blank page.');
  }
  const { mode, durationSeconds } = input;
  if (!MODES.includes(mode)) {
    throw new DecreeError('A ledger entry must name a Study, Rest, or Feast.');
  }
  if (typeof durationSeconds !== 'number' || !Number.isInteger(durationSeconds)) {
    throw new DecreeError('The duration must be a whole number of seconds.');
  }
  if (durationSeconds < 1 || durationSeconds > 36000) {
    throw new DecreeError('The duration must be between 1 and 36000 seconds.');
  }
  let completedAt = new Date().toISOString();
  if (input.completedAt !== undefined) {
    if (typeof input.completedAt !== 'string' || Number.isNaN(Date.parse(input.completedAt))) {
      throw new DecreeError('The completion date is not a date the stars recognise.');
    }
    completedAt = new Date(input.completedAt).toISOString();
  }
  return { mode, durationSeconds, completedAt };
}

module.exports = {
  DEFAULT_SETTINGS,
  LIMITS,
  MODES,
  DecreeError,
  validateSettings,
  validateSession,
};