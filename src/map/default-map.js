import {validateMap} from './format.js';
import {convertMiniKota} from './convert-minikota.js';
import {furnish} from './furnish.js';

// The maps the editor starts from: Mini Kota with every ordinary road two lanes each way
// (lot entrances stay access roads, the roundabout keeps its ring), bare or with every
// asset filled in. Tests use the same functions so they check what the editor shows.
export const DEFAULT_ROAD_PROFILE='jalan-2x2';
export function miniKotaRoads(){return validateMap(convertMiniKota({profile:DEFAULT_ROAD_PROFILE}));}
export function miniKotaLengkap(){const map=miniKotaRoads();map.name='Mini Kota lengkap';furnish(map);return map;}
