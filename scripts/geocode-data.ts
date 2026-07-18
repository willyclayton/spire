/**
 * Chicago geocoding reference data (verified against UChicago Chicago Studies,
 * chicagorailfan.com, Domu, USGS). Consumed by geocode-chicago.ts.
 *
 *  - Grid origin State & Madison = (41.8820, -87.6278); 800 address units = 1 mile.
 *  - Streets: grid number + direction + axis ('NS' = a north-south running street
 *    numbered east/west; 'EW' = an east-west running street numbered north/south).
 *  - Landmarks: building-level coordinates.
 *  - Neighborhoods: area-level centroids (drive the blue "general area" dots).
 */

export const GRID = {
  origin: { lat: 41.882, lon: -87.6278 },
  latPerMile: 0.0144893,
  lonPerMile: 0.0193888,
};

// [name, grid, dir, axis]  — dir '' means on-axis (grid 0).
type RawStreet = [string, number, '' | 'N' | 'S' | 'E' | 'W', 'NS' | 'EW'];

const RAW_STREETS: RawStreet[] = [
  // North–south streets (numbered East/West of State)
  ['State St', 0, '', 'NS'], ['Wabash Ave', 44, 'E', 'NS'], ['Michigan Ave', 100, 'E', 'NS'],
  ['Rush St', 65, 'E', 'NS'], ['Columbus Dr', 300, 'E', 'NS'], ['Lake Shore Dr', 400, 'E', 'NS'],
  ['King Dr', 400, 'E', 'NS'], ['Cottage Grove Ave', 800, 'E', 'NS'], ['Ellis Ave', 1000, 'E', 'NS'],
  ['Drexel Blvd', 900, 'E', 'NS'], ['Woodlawn Ave', 1200, 'E', 'NS'], ['Blackstone Ave', 1400, 'E', 'NS'],
  ['Stony Island Ave', 1600, 'E', 'NS'], ['Jeffery Blvd', 2000, 'E', 'NS'], ['Yates Ave', 2400, 'E', 'NS'],
  ['Dearborn St', 36, 'W', 'NS'], ['Clark St', 100, 'W', 'NS'], ['LaSalle St', 140, 'W', 'NS'],
  ['Wells St', 200, 'W', 'NS'], ['Franklin St', 300, 'W', 'NS'], ['Orleans St', 340, 'W', 'NS'],
  ['Canal St', 500, 'W', 'NS'], ['Clinton St', 540, 'W', 'NS'], ['Jefferson St', 600, 'W', 'NS'],
  ['Des Plaines St', 700, 'W', 'NS'], ['Stewart Ave', 400, 'W', 'NS'], ['Halsted St', 800, 'W', 'NS'],
  ['Morgan St', 1000, 'W', 'NS'], ['Racine Ave', 1200, 'W', 'NS'], ['Loomis St', 1400, 'W', 'NS'],
  ['Ashland Ave', 1600, 'W', 'NS'], ['Paulina St', 1700, 'W', 'NS'], ['Wood St', 1800, 'W', 'NS'],
  ['Damen Ave', 2000, 'W', 'NS'], ['Hoyne Ave', 2100, 'W', 'NS'], ['Leavitt St', 2200, 'W', 'NS'],
  ['Western Ave', 2400, 'W', 'NS'], ['Rockwell St', 2600, 'W', 'NS'], ['California Ave', 2800, 'W', 'NS'],
  ['Sacramento Ave', 3000, 'W', 'NS'], ['Kedzie Ave', 3200, 'W', 'NS'], ['Homan Ave', 3400, 'W', 'NS'],
  ['Central Park Ave', 3600, 'W', 'NS'], ['Pulaski Rd', 4000, 'W', 'NS'], ['Karlov Ave', 4100, 'W', 'NS'],
  ['Kostner Ave', 4400, 'W', 'NS'], ['Kilbourn Ave', 4500, 'W', 'NS'], ['Cicero Ave', 4800, 'W', 'NS'],
  ['Laramie Ave', 5200, 'W', 'NS'], ['Central Ave', 5600, 'W', 'NS'], ['Austin Blvd', 6000, 'W', 'NS'],
  ['Narragansett Ave', 6400, 'W', 'NS'], ['Oak Park Ave', 6800, 'W', 'NS'], ['Harlem Ave', 7200, 'W', 'NS'],

  // East–west streets (numbered North/South of Madison)
  ['Madison St', 0, '', 'EW'], ['Washington St', 100, 'N', 'EW'], ['Randolph St', 150, 'N', 'EW'],
  ['Lake St', 200, 'N', 'EW'], ['Kinzie St', 400, 'N', 'EW'], ['Hubbard St', 430, 'N', 'EW'],
  ['Illinois St', 500, 'N', 'EW'], ['Grand Ave', 530, 'N', 'EW'], ['Ohio St', 600, 'N', 'EW'],
  ['Ontario St', 628, 'N', 'EW'], ['Erie St', 658, 'N', 'EW'], ['Huron St', 700, 'N', 'EW'],
  ['Superior St', 732, 'N', 'EW'], ['Chicago Ave', 800, 'N', 'EW'], ['Division St', 1200, 'N', 'EW'],
  ['North Ave', 1600, 'N', 'EW'], ['Armitage Ave', 2000, 'N', 'EW'], ['Webster Ave', 2200, 'N', 'EW'],
  ['Fullerton Ave', 2400, 'N', 'EW'], ['Wrightwood Ave', 2600, 'N', 'EW'], ['Diversey Pkwy', 2800, 'N', 'EW'],
  ['Wellington Ave', 3000, 'N', 'EW'], ['Belmont Ave', 3200, 'N', 'EW'], ['Roscoe St', 3400, 'N', 'EW'],
  ['Addison St', 3600, 'N', 'EW'], ['Waveland Ave', 3700, 'N', 'EW'], ['Irving Park Rd', 4000, 'N', 'EW'],
  ['Montrose Ave', 4400, 'N', 'EW'], ['Wilson Ave', 4600, 'N', 'EW'], ['Lawrence Ave', 4800, 'N', 'EW'],
  ['Argyle St', 5000, 'N', 'EW'], ['Foster Ave', 5200, 'N', 'EW'], ['Berwyn Ave', 5300, 'N', 'EW'],
  ['Bryn Mawr Ave', 5600, 'N', 'EW'], ['Peterson Ave', 6000, 'N', 'EW'], ['Devon Ave', 6400, 'N', 'EW'],
  ['Pratt Blvd', 6800, 'N', 'EW'], ['Touhy Ave', 7200, 'N', 'EW'], ['Howard St', 7600, 'N', 'EW'],
  ['Monroe St', 100, 'S', 'EW'], ['Adams St', 200, 'S', 'EW'], ['Jackson Blvd', 300, 'S', 'EW'],
  ['Van Buren St', 400, 'S', 'EW'], ['Congress Pkwy', 500, 'S', 'EW'], ['Harrison St', 600, 'S', 'EW'],
  ['Balbo Dr', 700, 'S', 'EW'], ['Polk St', 800, 'S', 'EW'], ['Taylor St', 1000, 'S', 'EW'],
  ['Roosevelt Rd', 1200, 'S', 'EW'], ['Cermak Rd', 2200, 'S', 'EW'], ['Pershing Rd', 3900, 'S', 'EW'],
  ['Garfield Blvd', 5500, 'S', 'EW'],
];

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(?:st(?:reet)?|ave(?:nue)?|blvd|boulevard|rd|road|dr(?:ive)?|pl(?:ace)?|pkwy|parkway|ct|court|ln|lane|ter(?:race)?|way)\.?\s*$/i, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

export const STREETS: Record<string, { grid: number; dir: 'N' | 'S' | 'E' | 'W'; axis: 'ns' | 'ew' }> = {};
for (const [name, grid, dir, axis] of RAW_STREETS) {
  const key = normalizeName(name);
  if (!(key in STREETS)) {
    STREETS[key] = {
      grid,
      dir: (dir || (axis === 'NS' ? 'E' : 'N')) as 'N' | 'S' | 'E' | 'W',
      axis: axis === 'NS' ? 'ns' : 'ew',
    };
  }
}

interface Place {
  name: string;
  aliases: string[];
  lat: number;
  lon: number;
}

// Derive lowercase match aliases from a display name: main text + any parenthetical
// + slash-separated variants, minus a leading "the ".
function deriveAliases(name: string, extra: string[] = []): string[] {
  const out = new Set<string>(extra.map((a) => a.toLowerCase()));
  const paren = name.match(/\(([^)]+)\)/);
  const main = name.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  for (const part of main.split('/')) {
    const p = part.trim().toLowerCase().replace(/^the\s+/, '');
    if (p.length >= 3) out.add(p);
  }
  if (paren) {
    const p = paren[1].trim().toLowerCase();
    if (p.length >= 3 && !/^\d/.test(p)) out.add(p);
  }
  return [...out];
}

const RAW_LANDMARKS: Array<[string, number, number, string[]?]> = [
  ['Willis Tower (Sears Tower)', 41.8789, -87.6359], ['Wrigley Building', 41.8901, -87.6244],
  ['Tribune Tower', 41.8904, -87.6237], ['Marina City', 41.8885, -87.6345],
  ['Chicago Water Tower', 41.8971, -87.6244, ['water tower']], ['John Hancock Center', 41.8988, -87.6229, ['hancock']],
  ['Aon Center', 41.8853, -87.6216], ['Trump Tower Chicago', 41.8888, -87.6266],
  ['Aqua Tower', 41.8865, -87.6205], ['Field Museum', 41.8663, -87.6169],
  ['Art Institute of Chicago', 41.8796, -87.6237, ['art institute']], ['Shedd Aquarium', 41.8676, -87.614],
  ['Adler Planetarium', 41.8663, -87.6072], ['Union Station', 41.8786, -87.6398],
  ['Navy Pier', 41.8917, -87.6086], ['Buckingham Fountain', 41.8758, -87.6189],
  ['Cloud Gate (The Bean)', 41.8827, -87.6233], ['Millennium Park', 41.8826, -87.6226],
  ['Grant Park', 41.8755, -87.6189], ['Auditorium Building', 41.8757, -87.6255],
  ['The Rookery', 41.879, -87.6323, ['rookery building']], ['Monadnock Building', 41.8783, -87.6295],
  ['Reliance Building', 41.8829, -87.6284], ['Palmer House Hotel', 41.8797, -87.627, ['palmer house']],
  ['Chicago Board of Trade', 41.8777, -87.6323, ['board of trade']], ['Merchandise Mart', 41.8885, -87.6357],
  ['Chicago City Hall', 41.8837, -87.632], ['Daley Plaza', 41.884, -87.6299],
  ['Chicago Cultural Center', 41.8837, -87.6247], ['Chicago Theatre', 41.8853, -87.6275],
  ["Marshall Field's", 41.8829, -87.6278, ['marshall field', 'macy']], ['Civic Opera House', 41.882, -87.6378],
  ['Old Main Post Office', 41.8748, -87.6396], ['Holy Name Cathedral', 41.896, -87.6285],
  ['Museum of Contemporary Art', 41.8968, -87.6216], ['The Drake Hotel', 41.9008, -87.6247, ['drake hotel']],
  ['Museum of Science and Industry', 41.7906, -87.5831], ['Robie House', 41.7896, -87.596],
  ['University of Chicago', 41.7886, -87.5987], ['DuSable Museum', 41.7915, -87.6072],
  ['Soldier Field', 41.8623, -87.6167], ['McCormick Place', 41.8514, -87.6169],
  ['Guaranteed Rate Field', 41.8299, -87.6338, ['comiskey park', 'new comiskey']], ['Old Comiskey Park', 41.8312, -87.6339],
  ['Wrigley Field', 41.9484, -87.6553], ['Lincoln Park Zoo', 41.9216, -87.6337],
  ['The Second City', 41.911, -87.6345], ['Biograph Theater', 41.9257, -87.6538],
  ['Green Mill', 41.9696, -87.6595], ['Uptown Theatre', 41.9663, -87.6579],
  ['Garfield Park Conservatory', 41.8864, -87.7172], ['Haymarket Square', 41.8843, -87.6444, ['haymarket']],
  ['Maxwell Street', 41.8645, -87.6472], ['Union Stock Yards', 41.8177, -87.6565, ['stock yards', 'stockyards']],
  ['Pullman', 41.6939, -87.6094, ['hotel florence', 'pullman factory']], ["O'Hare International Airport", 41.9742, -87.9073, ['ohare']],
  ['Midway International Airport', 41.7868, -87.7522, ['midway airport']],
];

export const LANDMARKS: Place[] = RAW_LANDMARKS.map(([name, lat, lon, extra]) => ({
  name,
  lat,
  lon,
  aliases: deriveAliases(name, extra),
}));

const RAW_NEIGHBORHOODS: Array<[string, number, number, string[]?]> = [
  ['The Loop', 41.8786, -87.6298], ['Near North Side', 41.9003, -87.634], ['River North', 41.8925, -87.634],
  ['Streeterville', 41.8925, -87.62], ['Gold Coast', 41.907, -87.628], ['Old Town', 41.911, -87.637],
  ['Near South Side', 41.857, -87.625], ['South Loop', 41.867, -87.627], ['Near West Side', 41.875, -87.666],
  ['West Loop', 41.882, -87.65], ['Lincoln Park', 41.925, -87.648], ['Lakeview', 41.94, -87.653],
  ['Wrigleyville', 41.949, -87.655], ['Boystown / Northalsted', 41.944, -87.649], ['North Center', 41.956, -87.679],
  ['Uptown', 41.966, -87.655], ['Edgewater', 41.984, -87.662], ['Andersonville', 41.977, -87.669],
  ['Rogers Park', 42.01, -87.666], ['West Ridge', 41.998, -87.696], ['Ravenswood', 41.968, -87.684],
  ['Lincoln Square', 41.968, -87.689], ['Albany Park', 41.968, -87.724], ['Irving Park', 41.953, -87.737],
  ['Avondale', 41.939, -87.711], ['Logan Square', 41.927, -87.707], ['Humboldt Park', 41.902, -87.701],
  ['Wicker Park', 41.909, -87.677], ['Bucktown', 41.921, -87.679], ['West Town', 41.896, -87.672],
  ['Ukrainian Village', 41.899, -87.687], ['Pilsen', 41.857, -87.656], ['Little Village', 41.843, -87.7],
  ['Chinatown', 41.852, -87.632], ['Bridgeport', 41.838, -87.651], ['Bronzeville', 41.818, -87.618],
  ['Kenwood', 41.81, -87.597], ['Hyde Park', 41.7943, -87.5907], ['Woodlawn', 41.78, -87.596],
  ['South Shore', 41.762, -87.575], ['Englewood', 41.78, -87.642], ['Chatham', 41.74, -87.61],
  ['Auburn Gresham', 41.743, -87.656], ['Beverly', 41.718, -87.672], ['Morgan Park', 41.69, -87.667],
  ['Roseland', 41.7, -87.618], ['Pullman', 41.694, -87.61], ['South Chicago', 41.739, -87.554],
  ['Hegewisch', 41.656, -87.548], ['Austin', 41.89, -87.759], ['Garfield Park', 41.881, -87.7],
  ['North Lawndale', 41.858, -87.718], ['Portage Park', 41.954, -87.766], ['Jefferson Park', 41.97, -87.762],
  ['The South Side', 41.78, -87.61], ['The West Side', 41.875, -87.725], ['The North Side', 41.97, -87.69],
];

export const NEIGHBORHOODS: Place[] = RAW_NEIGHBORHOODS.map(([name, lat, lon, extra]) => ({
  name,
  lat,
  lon,
  aliases: deriveAliases(name, extra),
}));
