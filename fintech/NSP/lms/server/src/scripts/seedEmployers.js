import mongoose from 'mongoose';
import Company from '../models/Company.js';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/talentledger';

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const hiringStatus = () => {
  const r = Math.random();
  return r < 0.40 ? 'ACTIVELY_HIRING' : r < 0.85 ? 'OCCASIONALLY' : 'NOT_HIRING';
};
const companySize = () => pick(['MICRO', 'SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE']);
const companyType = () => {
  const r = Math.random();
  return r < 0.55 ? 'DIRECT_EMPLOYER' : r < 0.75 ? 'RECRUITMENT_AGENCY' : r < 0.90 ? 'CONTRACTOR' : 'STAFFING_AGENCY';
};

const SECTORS = ['Construction', 'Oil & Gas', 'Healthcare', 'IT & Technology', 'Manufacturing',
  'Hospitality', 'Retail', 'Finance & Banking', 'Education', 'Logistics & Transport',
  'Telecommunications', 'Agriculture', 'Mining', 'Real Estate', 'Security Services'];

const TRADES = ['Mason', 'Electrician', 'Plumber', 'Welder', 'HVAC Technician', 'Carpenter',
  'Steel Fixer', 'Heavy Equipment Operator', 'Civil Technician', 'Safety Officer',
  'Nurse', 'Lab Technician', 'IT Support', 'Network Engineer', 'Software Developer',
  'Chef', 'Driver', 'Security Guard', 'Painter', 'Tile Fixer'];

function makeRegion(n, regionDef) {
  return Array.from({ length: n }, (_, i) => {
    const c = pick(regionDef.countries);
    return {
      name: `${pick(regionDef.names)} ${i + 1}`,
      type: regionDef.fixedType || companyType(),
      sector: regionDef.fixedSector || pick(SECTORS),
      trades: [pick(TRADES), pick(TRADES)],
      location: { country: c.country, countryCode: c.code, city: pick(c.cities), region: regionDef.region },
      size: companySize(),
      hiringStatus: hiringStatus(),
      registration: regionDef.regFn ? regionDef.regFn() : {},
      verificationStatus: Math.random() < (regionDef.verifiedRate || 0.2) ? 'VERIFIED' : 'UNVERIFIED',
      source: regionDef.source || 'SEED',
    };
  });
}

const REGIONS = [
  {
    count: 1000, region: 'GCC',
    countries: [{ country: 'United Arab Emirates', code: 'AE', cities: ['Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman'] }],
    names: ['Al Futtaim', 'Emaar', 'ADNOC', 'Dubai Holding', 'Majid Al Futtaim', 'Transguard', 'Serco', 'G4S UAE', 'Drake Scull', 'Arabtec', 'Dutco', 'ALEC', 'Khansaheb', 'Galadari', 'Al Habtoor'],
    regFn: () => ({ mohreNumber: `MOHRE-${rand(10000, 99999)}`, source: 'MOHRE' }),
    verifiedRate: 0.6,
  },
  {
    count: 800, region: 'GCC',
    countries: [{ country: 'Saudi Arabia', code: 'SA', cities: ['Riyadh', 'Jeddah', 'Dammam', 'Khobar', 'Jubail'] }],
    names: ['Saudi Aramco', 'SABIC', 'STC', 'Al Rajhi', 'Binladin Group', 'Saudi Oger', 'Al Arrab', 'Nesma', 'Almabani', 'Al Bawani'],
    verifiedRate: 0.3,
  },
  {
    count: 400, region: 'GCC',
    countries: [{ country: 'Qatar', code: 'QA', cities: ['Doha', 'Al Rayyan', 'Al Wakrah', 'Lusail'] }],
    names: ['Qatar Petroleum', 'Qatargas', 'Ooredoo', 'Al Jaber', 'HBK Contracting', 'Midmac', 'Galfar', 'Gulf Contracting', 'Power International', 'RedTag'],
    verifiedRate: 0.3,
  },
  {
    count: 300, region: 'GCC',
    countries: [{ country: 'Kuwait', code: 'KW', cities: ['Kuwait City', 'Salmiya', 'Hawalli'] }],
    names: ['KOC', 'KNPC', 'Zain', 'NBK', 'Gulf Bank', 'Kharafi National', 'Combined Group', 'Energya Steel', 'Al Sayer', 'Agility'],
    verifiedRate: 0.2,
  },
  {
    count: 300, region: 'GCC',
    countries: [{ country: 'Oman', code: 'OM', cities: ['Muscat', 'Salalah', 'Sohar', 'Sur'] }],
    names: ['PDO', 'OQ', 'Nawras', 'Renaissance Services', 'Galfar Engineering', 'Carrefour Oman', 'Al Ansari', 'Oman Cement', 'National Finance', 'Bahwan'],
    verifiedRate: 0.2,
  },
  {
    count: 200, region: 'GCC',
    countries: [{ country: 'Bahrain', code: 'BH', cities: ['Manama', 'Muharraq', 'Riffa'] }],
    names: ['BAPCO', 'Alba', 'Batelco', 'NBB', 'Ithmaar Bank', 'Al Moayyed', 'Nass Group', 'Gulf Hotels', 'Zain Bahrain', 'Investcorp'],
    verifiedRate: 0.2,
  },
  {
    count: 1500, region: 'South Asia',
    countries: [{ country: 'Pakistan', code: 'PK', cities: ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta', 'Sialkot'] }],
    names: ['Al-Hamd Overseas', 'Falcon Recruitment', 'Gulf Manpower', 'Pak Gulf Manpower', 'Al-Noor Overseas', 'Khyber Manpower', 'Punjab Overseas', 'Sindh Manpower Bureau', 'National Manpower', 'Al-Baraka Overseas', 'Islamabad Manpower', 'Karachi Overseas', 'Pakistan Overseas Employment', 'Pak Labour Bureau', 'Balochistan Overseas'],
    fixedType: 'RECRUITMENT_AGENCY',
    fixedSector: 'Labour Recruitment',
    regFn: () => ({ beoeNumber: `BEOE-${rand(1000, 9999)}`, source: 'BEOE' }),
    verifiedRate: 0.4,
    source: 'BEOE',
  },
  {
    count: 500, region: 'South Asia',
    countries: [{ country: 'Pakistan', code: 'PK', cities: ['Karachi', 'Lahore', 'Islamabad', 'Gwadar', 'Faisalabad'] }],
    names: ['FWO Engineering', 'NLC Pakistan', 'Descon Engineering', 'Lucky Cement', 'Packages Group', 'Engro Corporation', 'K-Electric', 'OGDCL', 'PSO', 'Fauji Fertilizer', 'Millat Tractors', 'Atlas Honda', 'Indus Motor', 'Pakistan Steel', 'PIA'],
    regFn: () => ({ pecNumber: `PEC-${rand(1000, 9999)}`, source: 'PEC' }),
    verifiedRate: 0.2,
  },
  {
    count: 500, region: 'Europe',
    countries: [
      { country: 'Germany', code: 'DE', cities: ['Berlin', 'Frankfurt', 'Munich', 'Hamburg'] },
      { country: 'Poland', code: 'PL', cities: ['Warsaw', 'Krakow', 'Wroclaw'] },
      { country: 'Netherlands', code: 'NL', cities: ['Amsterdam', 'Rotterdam'] },
      { country: 'France', code: 'FR', cities: ['Paris', 'Lyon', 'Marseille'] },
      { country: 'United Kingdom', code: 'GB', cities: ['London', 'Manchester', 'Birmingham'] },
      { country: 'Spain', code: 'ES', cities: ['Madrid', 'Barcelona'] },
      { country: 'Italy', code: 'IT', cities: ['Milan', 'Rome', 'Turin'] },
    ],
    names: ['Siemens', 'Bosch', 'Volkswagen', 'Deutsche Bank', 'BASF', 'Philips', 'Unilever', 'Shell', 'BP', 'Rolls-Royce', 'Airbus', 'Total Energies', 'Schneider Electric', 'Atos', 'Capgemini'],
    verifiedRate: 0.2,
  },
  {
    count: 400, region: 'Far East',
    countries: [
      { country: 'Malaysia', code: 'MY', cities: ['Kuala Lumpur', 'Johor Bahru', 'Penang'] },
      { country: 'Singapore', code: 'SG', cities: ['Singapore'] },
      { country: 'South Korea', code: 'KR', cities: ['Seoul', 'Busan', 'Incheon'] },
      { country: 'Japan', code: 'JP', cities: ['Tokyo', 'Osaka', 'Nagoya'] },
    ],
    names: ['Petronas', 'Maybank', 'Tenaga Nasional', 'Samsung', 'LG', 'Hyundai', 'Toyota', 'Sony', 'Panasonic', 'DBS Bank', 'CIMB', 'Singapore Airlines', 'RHB', 'Hong Leong', 'Hitachi'],
    verifiedRate: 0.2,
  },
  {
    count: 300, region: 'Oceania',
    countries: [
      { country: 'Australia', code: 'AU', cities: ['Sydney', 'Melbourne', 'Brisbane', 'Perth'] },
      { country: 'New Zealand', code: 'NZ', cities: ['Auckland', 'Wellington', 'Christchurch'] },
    ],
    names: ['BHP', 'Rio Tinto', 'Woodside', 'ANZ Bank', 'Commonwealth Bank', 'Telstra', 'Wesfarmers', 'Woolworths', 'Lendlease', 'John Holland', 'CIMIC', 'Laing Rourke', 'Broadspectrum', 'Spotless', 'CPB Contractors'],
    verifiedRate: 0.2,
  },
  {
    count: 300, region: 'Americas',
    countries: [
      { country: 'United States', code: 'US', cities: ['New York', 'Houston', 'Chicago', 'Los Angeles'] },
      { country: 'Canada', code: 'CA', cities: ['Toronto', 'Vancouver', 'Calgary'] },
      { country: 'Brazil', code: 'BR', cities: ['Sao Paulo', 'Rio de Janeiro'] },
    ],
    names: ['Bechtel', 'Fluor', 'Jacobs Engineering', 'AECOM', 'KBR', 'Caterpillar', 'Halliburton', 'Schlumberger', 'Baker Hughes', 'SNC-Lavalin', 'PCL Constructors', 'EllisDon', 'Vale', 'Andrade Gutierrez', 'Odebrecht'],
    verifiedRate: 0.2,
  },
  {
    count: 200, region: 'Africa',
    countries: [
      { country: 'South Africa', code: 'ZA', cities: ['Johannesburg', 'Cape Town', 'Durban'] },
      { country: 'Nigeria', code: 'NG', cities: ['Lagos', 'Abuja', 'Port Harcourt'] },
      { country: 'Kenya', code: 'KE', cities: ['Nairobi', 'Mombasa'] },
      { country: 'Egypt', code: 'EG', cities: ['Cairo', 'Alexandria'] },
    ],
    names: ['Sasol', 'Anglo American', 'MTN', 'Dangote', 'Zenith Bank', 'Equity Bank', 'Safaricom', 'Orascom', 'EDF Africa', 'Total Africa', 'Standard Bank', 'Nedbank', 'Econet', 'Vodacom', 'Access Bank'],
    verifiedRate: 0.2,
  },
  {
    count: 300, region: 'Other',
    countries: [
      { country: 'Turkey', code: 'TR', cities: ['Istanbul', 'Ankara', 'Izmir'] },
      { country: 'Jordan', code: 'JO', cities: ['Amman', 'Aqaba'] },
      { country: 'Iraq', code: 'IQ', cities: ['Baghdad', 'Basra', 'Erbil'] },
      { country: 'India', code: 'IN', cities: ['Mumbai', 'Delhi', 'Bangalore', 'Chennai'] },
      { country: 'Philippines', code: 'PH', cities: ['Manila', 'Cebu', 'Davao'] },
      { country: 'Indonesia', code: 'ID', cities: ['Jakarta', 'Surabaya', 'Medan'] },
      { country: 'Bangladesh', code: 'BD', cities: ['Dhaka', 'Chittagong'] },
    ],
    names: ['Tekfen', 'Kalyon', 'TAV Construction', 'Limak', 'IC Ictas', 'Agility', 'Trans Global', 'Apex Overseas', 'Pioneer Recruitment', 'Summit HR', 'Eastern Manpower', 'Global Overseas', 'Horizon Group', 'Pacific Manpower', 'Infosys'],
    verifiedRate: 0.1,
  },
];

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  const existing = await Company.countDocuments();
  if (existing > 0) {
    console.log(`Existing companies: ${existing}. Dropping to re-seed...`);
    await Company.deleteMany({});
  }

  let all = [];
  for (const r of REGIONS) {
    all = all.concat(makeRegion(r.count, r));
  }

  const topUpRegion = REGIONS[REGIONS.length - 1];
  while (all.length < 10000) {
    all = all.concat(makeRegion(Math.min(100, 10000 - all.length), topUpRegion));
  }
  all = all.slice(0, 10000);

  console.log(`Inserting ${all.length} records in batches of 500...`);
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < all.length; i += BATCH) {
    await Company.insertMany(all.slice(i, i + BATCH), { ordered: false });
    inserted += Math.min(BATCH, all.length - i);
    process.stdout.write(`\r  Inserted: ${inserted}/${all.length}`);
  }
  console.log('\n');

  const total = await Company.countDocuments();
  const activelyHiring = await Company.countDocuments({ hiringStatus: 'ACTIVELY_HIRING' });
  const verified = await Company.countDocuments({ verificationStatus: 'VERIFIED' });
  const beoe = await Company.countDocuments({ source: 'BEOE' });
  console.log('=== Seed complete ===');
  console.log(`Total companies:   ${total}`);
  console.log(`Actively hiring:   ${activelyHiring}`);
  console.log(`Verified:          ${verified}`);
  console.log(`BEOE agencies:     ${beoe}`);

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });
