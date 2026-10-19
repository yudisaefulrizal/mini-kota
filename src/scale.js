// The reference artwork uses map units. Physics uses metres and seconds.
// A 28-unit road represents an 11.2 m urban street including its margins.
export const METRES_PER_MAP_UNIT = 0.4;
export const toMetres = units => units * METRES_PER_MAP_UNIT;
export const toMapUnits = metres => metres / METRES_PER_MAP_UNIT;
export const CAR_LENGTH_METRES = 4.5;
export const TRUCK_LENGTH_METRES = 7;
export const vehicleLength = car => car.wasteTruck ? TRUCK_LENGTH_METRES : CAR_LENGTH_METRES;
