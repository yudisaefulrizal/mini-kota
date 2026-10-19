import {validateMap} from './format.js';
import {furnish} from './furnish.js';
import MINI_KOTA from './mini-kota-data.js';

// The maps the app and the editor start from: Mini Kota with every ordinary road two lanes
// each way (lot entrances stay access roads, the roundabout keeps its ring), bare or with
// every asset filled in. Tests use the same functions so they check what is shown.
export const DEFAULT_ROAD_PROFILE='jalan-2x2';
export function miniKotaRoads(){return validateMap(structuredClone(MINI_KOTA));}
export function miniKotaLengkap(){const map=miniKotaRoads();map.name='Mini Kota lengkap';furnish(map);return map;}
