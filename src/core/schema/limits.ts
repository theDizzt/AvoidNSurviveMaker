export const LIMITS = {
  minSize: 200,
  maxSize: 4000,
  maxObjects: 2000,
  maxPolyPoints: 256,
  maxMarkers: 64,
  maxSpeed: 5000,
  /** Wavy routes (#30 boulder) */
  maxWaveAmplitude: 500,
  minWavelength: 16,
  maxWavelength: 4000,
  maxRotSpeed: 3600,
  maxAngle: 36000,
  maxDelay: 600_000,
  maxText: 60,
  maxLevel: 9999,
  /** Longest star time (ms) */
  maxStarTime: 3_600_000,
  maxPackLevels: 200,
  /** Coins are always this size (diameter) */
  coinSize: 24,
  /** Crystal stars (#59) are always this size, and a map has at most this many */
  crystalSize: 48,
  maxCrystals: 1,
  /** Turrets (#60) and missile launchers (#61) are always this size (square) */
  turretSize: 60,
  /** Conveyor belts (#69): centerline points, belt width (px) */
  maxBeltPoints: 64,
  /** Wires (#91): points along the cable */
  maxWirePoints: 64,
  minBeltWidth: 20,
  maxBeltWidth: 300,
  maxTurretRange: 4000,
  minFireMs: 50,
  /** Global darkness light radius */
  minLight: 0,
  maxLight: 2000,
  /** Radioactive waste (#116 / #117): largest aura radius (px) */
  maxAura: 2000,
  /** Magnets (#99): farthest pull (px) */
  maxMagnetRange: 2000,
} as const;
