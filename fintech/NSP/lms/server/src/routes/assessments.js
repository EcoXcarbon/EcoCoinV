import { Router } from 'express';
import { body, param, query } from 'express-validator';
import multer from 'multer';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import Assessment from '../models/Assessment.js';
import Worker from '../models/Worker.js';
import Training from '../models/Training.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { handleValidation } from '../middleware/validate.js';
import { auditLog } from '../middleware/audit.js';
import { requiresExternalModeration } from '../config/rplConfig.js';
import { emitStatement, buildActor, buildVerb, buildActivity, emitRPLEvidenceSubmitted, emitAssessmentCompleted } from '../services/xapiService.js';
import { createRPLNotification } from '../services/notificationService.js';
import Credential from '../models/Credential.js';
import User from '../models/User.js';
import Venue from '../models/Venue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Allowed MIME types for security
const ALLOWED_MIME = {
  video: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'],
  document: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
};

const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, '../../uploads'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
      const safeName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
      cb(null, safeName);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allAllowed = [...ALLOWED_MIME.video, ...ALLOWED_MIME.document];
    if (!allAllowed.includes(file.mimetype)) {
      return cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = /\.(mp4|mov|avi|webm|pdf|jpg|jpeg|png|webp)$/;
    if (!allowedExts.test(ext)) {
      return cb(new Error(`File extension ${ext} not allowed`), false);
    }
    cb(null, true);
  },
});

const router = Router();

const VALID_TYPES = ['rpl', 'checklist', 'simulation', 'video'];
const VALID_STATUSES = ['pending', 'in-review', 'approved', 'rejected', 'needs-revision', 'awaiting-moderation', 'awaiting-external-moderation', 'appealed'];
const EVIDENCE_CATEGORIES = ['experience-letter', 'trade-certificate', 'reference-letter', 'work-sample', 'identity-doc', 'other'];

// Issue #2: Default interview template per trade
const INTERVIEW_TEMPLATES = {
  default: [
    { competencyArea: 'Core Trade Skills', question: 'Describe your experience with the primary tasks of your trade. What types of projects have you worked on?' },
    { competencyArea: 'Safety & PPE', question: 'What safety procedures and PPE do you follow on a construction site? Describe a safety incident you handled.' },
    { competencyArea: 'Tools & Equipment', question: 'Which specialized tools and equipment are you proficient with? How do you maintain them?' },
    { competencyArea: 'Blueprint Reading', question: 'Can you read construction drawings and specifications? Give an example of interpreting a technical drawing.' },
    { competencyArea: 'Quality Standards', question: 'How do you ensure your work meets quality standards? What measurements and checks do you perform?' },
    { competencyArea: 'Problem Solving', question: 'Describe a challenging situation on a job site and how you resolved it.' },
  ],
  mason: [
    { competencyArea: 'Foundation Laying', question: 'Describe your experience laying foundations and footings. What soil conditions have you worked with?' },
    { competencyArea: 'Brick & Block Bonding', question: 'Explain the bonding patterns you have used (stretcher, English, Flemish). When would you choose each?' },
    { competencyArea: 'Plastering', question: 'Describe your plastering technique for internal and external walls. How do you achieve a consistent finish?' },
    { competencyArea: 'Leveling & Alignment', question: 'What leveling instruments do you use and how do you maintain alignment over long wall runs?' },
    { competencyArea: 'Mortar Mixing', question: 'Explain the mortar mix ratios you use for different applications and how you ensure consistency.' },
    { competencyArea: 'Safety Compliance', question: 'What safety procedures do you follow when working on masonry at height or near excavations?' },
  ],
  electrician: [
    { competencyArea: 'Wiring Installation', question: 'Describe a residential or commercial wiring project you completed. What cable types and methods did you use?' },
    { competencyArea: 'Circuit Design', question: 'How do you plan and design electrical circuits? Walk through your process for a typical installation.' },
    { competencyArea: 'Safety & Grounding', question: 'Explain your approach to electrical safety, earthing, and grounding. How do you verify a safe installation?' },
    { competencyArea: 'Panel Installation', question: 'Describe your experience installing distribution boards. How do you size breakers and balance loads?' },
    { competencyArea: 'Testing & Measurement', question: 'What electrical testing instruments do you use? Describe how you perform insulation resistance and continuity tests.' },
    { competencyArea: 'Troubleshooting', question: 'Walk through how you diagnose an electrical fault from symptoms to resolution.' },
  ],
  welder: [
    { competencyArea: 'SMAW/Stick Welding', question: 'Describe your experience with shielded metal arc welding. What electrode types and positions have you worked with?' },
    { competencyArea: 'MIG/MAG Welding', question: 'Explain your MIG/MAG welding technique. How do you set wire speed, voltage, and gas flow for different materials?' },
    { competencyArea: 'TIG Welding', question: 'Describe your TIG welding experience. What materials and joint configurations have you welded?' },
    { competencyArea: 'Joint Preparation', question: 'How do you prepare joints for welding? Explain your approach to beveling, fit-up, and tack welding.' },
    { competencyArea: 'Blueprint & WPS Reading', question: 'How do you read welding procedure specifications and welding symbols on drawings?' },
    { competencyArea: 'Weld Quality Inspection', question: 'How do you identify and prevent common weld defects such as porosity, undercut, and lack of fusion?' },
  ],
  plumber: [
    { competencyArea: 'Pipe Joining Methods', question: 'Describe the pipe joining methods you are proficient in (solvent cement, threaded, PPR fusion, compression).' },
    { competencyArea: 'Drainage Systems', question: 'Explain how you install a DWV system. How do you ensure proper slope and venting?' },
    { competencyArea: 'Water Supply Systems', question: 'Describe your experience installing hot and cold water supply systems. What pipe materials have you used?' },
    { competencyArea: 'Fixture Installation', question: 'Walk through how you install a complete bathroom set (toilet, basin, shower). What are the key considerations?' },
    { competencyArea: 'Code Compliance', question: 'What plumbing codes and standards do you follow? How do you ensure your installations are compliant?' },
    { competencyArea: 'Leak Detection & Repair', question: 'Describe how you perform pressure testing and diagnose leaks in a plumbing system.' },
  ],
  carpenter: [
    { competencyArea: 'Wood Selection & Treatment', question: 'Describe your knowledge of timber types and how you select the right wood for different applications.' },
    { competencyArea: 'Joinery Techniques', question: 'What joinery techniques have you used (mortise-tenon, dovetail, lap joints)? Describe a complex joint you created.' },
    { competencyArea: 'Power Tool Operation', question: 'Which power tools are you proficient with? Describe your experience with circular saws, routers, and planers.' },
    { competencyArea: 'Formwork Construction', question: 'Describe your experience building concrete formwork. How do you ensure it can withstand the concrete pressure?' },
    { competencyArea: 'Door & Window Fitting', question: 'Walk through your process for installing a door or window frame, including alignment and finishing.' },
    { competencyArea: 'Measurement & Layout', question: 'How do you ensure accuracy in measurements and layout? What tools and techniques do you use?' },
  ],
  'steel-fixer': [
    { competencyArea: 'Bar Bending Schedules', question: 'Explain how you read and interpret a bar bending schedule as per BS 8666. Give an example.' },
    { competencyArea: 'Rebar Cutting & Bending', question: 'Describe your technique for cutting and bending reinforcement bars to specification.' },
    { competencyArea: 'Rebar Tying & Placement', question: 'How do you place and tie reinforcement cages? What methods and tools do you use?' },
    { competencyArea: 'Cover & Spacer Installation', question: 'How do you ensure correct concrete cover? What types of spacers do you use and why?' },
    { competencyArea: 'Lap Length Calculation', question: 'Explain how you determine lap lengths and splice positions for different bar sizes.' },
    { competencyArea: 'Foundation Reinforcement', question: 'Describe your experience reinforcing foundations, footings, and raft slabs.' },
  ],
  painter: [
    { competencyArea: 'Surface Preparation', question: 'Describe your surface preparation process. How do you handle different substrates (concrete, wood, metal)?' },
    { competencyArea: 'Paint Selection', question: 'Explain how you select the right paint type (distemper, emulsion, enamel, epoxy) for different applications.' },
    { competencyArea: 'Application Techniques', question: 'Describe your brush, roller, and spray painting techniques. When do you use each method?' },
    { competencyArea: 'Color Mixing & Matching', question: 'How do you approach color mixing and shade matching? Describe a project where precise color was critical.' },
    { competencyArea: 'Decorative Finishes', question: 'What decorative finishing techniques have you applied (texture, stencil, faux finishes)? Describe your approach.' },
    { competencyArea: 'Safety & Hazard Management', question: 'What safety precautions do you take when working with paints, solvents, and at height?' },
  ],
  hvac: [
    { competencyArea: 'Refrigeration Cycle', question: 'Explain the vapor compression refrigeration cycle and how you use this knowledge in troubleshooting.' },
    { competencyArea: 'AC Installation', question: 'Describe your experience installing split and package AC units. What is your installation process?' },
    { competencyArea: 'Ductwork Design', question: 'How do you fabricate and install HVAC ductwork? What sizing methods do you use?' },
    { competencyArea: 'Refrigerant Handling', question: 'Describe your experience with refrigerant types, charging procedures, and recovery techniques.' },
    { competencyArea: 'Troubleshooting', question: 'Walk through how you diagnose an HVAC system fault using gauges, meters, and systematic testing.' },
    { competencyArea: 'Safety & Regulations', question: 'What safety procedures and regulations (F-gas, ASHRAE) do you follow in HVAC work?' },
  ],
  'pipe-fitter': [
    { competencyArea: 'Pipe Fabrication', question: 'Describe your experience cutting, beveling, and fitting industrial pipes. What methods do you use?' },
    { competencyArea: 'Flange Connections', question: 'Explain how you assemble flanged joints. How do you select gaskets and achieve proper bolt torque?' },
    { competencyArea: 'Isometric Drawings', question: 'How do you read and interpret pipe isometric and spool drawings? Give an example.' },
    { competencyArea: 'Pressure Testing', question: 'Describe your experience with hydrostatic and pneumatic pressure testing procedures.' },
    { competencyArea: 'Valve & Fitting Installation', question: 'What types of valves have you installed? How do you determine correct valve selection and orientation?' },
    { competencyArea: 'Confined Space & Hot Work', question: 'Describe your experience working under permit-to-work systems and in confined spaces.' },
  ],
  scaffolder: [
    { competencyArea: 'Tube & Fitting Scaffolding', question: 'Describe your experience erecting tube and fitting scaffolds. What configurations have you built?' },
    { competencyArea: 'System Scaffolding', question: 'What modular scaffold systems (Cuplock, Ringlock) have you worked with? Describe a complex erection.' },
    { competencyArea: 'Working at Heights', question: 'What fall protection methods do you use? Describe your approach to harness use and edge protection.' },
    { competencyArea: 'Load Calculations', question: 'How do you determine scaffold load classes and safe working loads for different applications?' },
    { competencyArea: 'Scaffold Inspection', question: 'Describe your scaffold inspection process. What defects do you look for and how do you tag scaffolds?' },
    { competencyArea: 'Dismantling Procedures', question: 'Explain the safe sequence for dismantling scaffolding. What are the key safety considerations?' },
  ],
  rigger: [
    { competencyArea: 'Sling Selection', question: 'How do you select the correct sling type and capacity for a lift? Explain WLL considerations.' },
    { competencyArea: 'Load Weight Estimation', question: 'Describe how you calculate load weights from dimensions and material properties.' },
    { competencyArea: 'Rigging Hardware', question: 'What rigging hardware have you used (shackles, eyebolts, spreader beams)? How do you inspect them?' },
    { competencyArea: 'Crane Signal Communication', question: 'Demonstrate your knowledge of standard hand signals and radio communication protocols.' },
    { competencyArea: 'Lift Planning', question: 'Walk through how you develop a rigging plan for a complex lift.' },
    { competencyArea: 'Safety & PTW Systems', question: 'Describe your experience with permit-to-work systems and establishing exclusion zones.' },
  ],
  'crane-operator': [
    { competencyArea: 'Mobile Crane Operation', question: 'Describe your experience operating mobile/hydraulic cranes. What capacities have you operated?' },
    { competencyArea: 'Tower Crane Operation', question: 'What tower crane types (flat top, luffing) have you operated? Describe your daily routine.' },
    { competencyArea: 'Load Charts', question: 'How do you read and apply crane load charts? Give an example of chart interpretation for a specific lift.' },
    { competencyArea: 'Ground Conditions', question: 'How do you assess ground bearing pressure and set up outriggers for safe crane operation?' },
    { competencyArea: 'Lift Planning', question: 'Describe your approach to lift planning, including radius calculation and boom length selection.' },
    { competencyArea: 'Emergency Procedures', question: 'What emergency procedures are you trained in? Describe how you would respond to a crane malfunction.' },
  ],
  'heavy-driver': [
    { competencyArea: 'Vehicle Pre-Trip Inspection', question: 'Walk through your daily vehicle pre-trip inspection procedure.' },
    { competencyArea: 'Defensive Driving', question: 'Describe defensive driving techniques you apply when operating heavy vehicles.' },
    { competencyArea: 'Load Securing', question: 'How do you secure different types of loads? What equipment (chains, straps, dunnage) do you use?' },
    { competencyArea: 'Route Planning', question: 'How do you plan routes considering weight limits, clearances, and road restrictions?' },
    { competencyArea: 'Reversing & Maneuvering', question: 'Describe your technique for reversing and maneuvering in tight spaces.' },
    { competencyArea: 'Traffic Regulations', question: 'What traffic laws and regulations specific to heavy vehicles do you follow?' },
  ],
  'shuttering-carpenter': [
    { competencyArea: 'Column Formwork', question: 'Describe your experience building column shuttering/formwork. How do you ensure plumb and dimension?' },
    { competencyArea: 'Beam & Slab Formwork', question: 'Explain your approach to constructing beam and slab formwork systems.' },
    { competencyArea: 'Formwork Alignment', question: 'How do you align and level formwork to specified tolerances? What instruments do you use?' },
    { competencyArea: 'Props & Support Systems', question: 'Describe your knowledge of propping systems and how you ensure adequate load distribution.' },
    { competencyArea: 'Stripping & Striking', question: 'How do you determine when to strip formwork? Describe your safe removal procedure.' },
    { competencyArea: 'Formwork Materials', question: 'What formwork materials (plywood, steel, aluminum) have you worked with? Compare their advantages.' },
  ],
  'tile-fixer': [
    { competencyArea: 'Floor Tiling', question: 'Describe your floor tiling technique. How do you ensure proper adhesive coverage and level finish?' },
    { competencyArea: 'Wall Tiling', question: 'Explain your approach to wall tiling. How do you handle corners, edges, and alignment?' },
    { competencyArea: 'Tile Cutting', question: 'What tile cutting tools and techniques do you use for different tile materials and shapes?' },
    { competencyArea: 'Surface Preparation', question: 'How do you prepare substrates for tiling? Describe your waterproofing approach for wet areas.' },
    { competencyArea: 'Layout & Pattern Setting', question: 'How do you plan tile layout and patterns? Describe your approach to datum lines and spacing.' },
    { competencyArea: 'Grouting & Finishing', question: 'Describe your grouting technique. How do you achieve clean, consistent joints?' },
  ],
  'duct-fabricator': [
    { competencyArea: 'Sheet Metal Layout', question: 'Describe how you develop flat patterns from duct drawings. What methods do you use?' },
    { competencyArea: 'Cutting & Forming', question: 'What cutting and forming equipment (shears, brakes, roll-formers) are you proficient with?' },
    { competencyArea: 'Joint & Seam Types', question: 'Explain different seam types (Pittsburgh, snap-lock, TDF) and when you use each.' },
    { competencyArea: 'Rectangular Duct Fabrication', question: 'Walk through your process for fabricating rectangular ductwork from flat sheet.' },
    { competencyArea: 'Round/Spiral Duct Work', question: 'Describe your experience with round duct, elbows, and transition fabrication.' },
    { competencyArea: 'Duct Sizing & Standards', question: 'How do you determine duct sizes? What standards (SMACNA) do you follow?' },
  ],
  'auto-mechanic': [
    { competencyArea: 'Engine Diagnostics', question: 'Describe how you diagnose engine faults using OBD-II scanners and systematic troubleshooting.' },
    { competencyArea: 'Brake Systems', question: 'Explain your approach to servicing disc and drum brake systems. What inspections do you perform?' },
    { competencyArea: 'Suspension & Steering', question: 'How do you diagnose and repair suspension and steering components? Give a specific example.' },
    { competencyArea: 'Electrical Systems', question: 'Describe your experience with vehicle electrical systems including charging and starting circuits.' },
    { competencyArea: 'Transmission Service', question: 'What transmission types (manual, automatic) have you serviced? Describe your diagnostic approach.' },
    { competencyArea: 'Engine Overhaul', question: 'Walk through your process for an engine teardown, inspection, and reassembly.' },
  ],
  'diesel-mechanic': [
    { competencyArea: 'Diesel Engine Fundamentals', question: 'Explain the diesel combustion cycle and how it differs from petrol. How does this affect diagnostics?' },
    { competencyArea: 'Fuel Injection Systems', question: 'Describe your experience with common rail, unit injector, and mechanical fuel injection systems.' },
    { competencyArea: 'Turbocharger Systems', question: 'How do you inspect and service turbochargers and intercoolers? What faults do you look for?' },
    { competencyArea: 'Hydraulic Systems', question: 'Describe your experience diagnosing faults in hydraulic pumps, cylinders, and control valves.' },
    { competencyArea: 'Exhaust After-Treatment', question: 'Explain your knowledge of DPF, SCR, and emissions control systems and their maintenance.' },
    { competencyArea: 'Preventive Maintenance', question: 'Describe your approach to scheduled preventive maintenance services and inspections on heavy equipment.' },
  ],
  fabricator: [
    { competencyArea: 'Steel Cutting', question: 'Describe your experience with oxy-fuel, plasma, and mechanical cutting methods.' },
    { competencyArea: 'Structural Steel Assembly', question: 'Explain your process for fitting and assembling structural steel sections.' },
    { competencyArea: 'Bolted Connections', question: 'How do you ensure correct bolt grade selection, torque, and tensioning in structural connections?' },
    { competencyArea: 'Plate Work', question: 'Describe your skills in laying out, cutting, and forming steel plate components.' },
    { competencyArea: 'Blueprint Reading', question: 'How do you read structural and fabrication drawings? Give an example of interpreting complex details.' },
    { competencyArea: 'Dimensional Control', question: 'What measuring and dimensional checking methods do you use to ensure fabrication accuracy?' },
  ],
  'insulation-worker': [
    { competencyArea: 'Thermal Insulation', question: 'Describe your experience installing thermal insulation on pipes and equipment. What materials have you used?' },
    { competencyArea: 'Cladding & Jacketing', question: 'Explain your technique for installing aluminum or stainless steel cladding over insulation.' },
    { competencyArea: 'Material Selection', question: 'How do you select the correct insulation material (mineral wool, foam, fiberglass) for different applications?' },
    { competencyArea: 'Pipe & Vessel Insulation', question: 'Describe your approach to insulating pipes, tanks, and vessels of different shapes and sizes.' },
    { competencyArea: 'Cold Insulation', question: 'What is your experience with cold/cryogenic insulation? How do you handle vapor barriers?' },
    { competencyArea: 'Safety & Hazardous Materials', question: 'What safety precautions do you take when handling insulation materials, including asbestos awareness?' },
  ],
  'heavy-equipment-operator': [
    { competencyArea: 'Excavator Operation', question: 'Describe your experience operating hydraulic excavators. What types of work have you performed?' },
    { competencyArea: 'Loader Operation', question: 'What loader types (wheel, backhoe) have you operated? Describe your most complex operation.' },
    { competencyArea: 'Bulldozer/Grader Operation', question: 'Describe your experience with bulldozers and motor graders, including grade work.' },
    { competencyArea: 'Pre-Operation Checks', question: 'Walk through your daily machine inspection and walk-around check procedure.' },
    { competencyArea: 'Grade & Level Control', question: 'How do you achieve specified grades and levels? What control systems have you used?' },
    { competencyArea: 'Site Safety', question: 'Describe how you manage exclusion zones, work with spotters, and handle site traffic.' },
  ],
  'aluminium-fabricator': [
    { competencyArea: 'Aluminium Profile Cutting', question: 'Describe your experience cutting aluminium profiles to precise dimensions. What tools do you use?' },
    { competencyArea: 'Window & Door Fabrication', question: 'Walk through your process for fabricating an aluminium window or door frame.' },
    { competencyArea: 'Curtain Wall Systems', question: 'Describe your knowledge of curtain wall systems. What assembly and installation experience do you have?' },
    { competencyArea: 'Glass Installation', question: 'How do you safely handle and install glass panels? What safety precautions do you take?' },
    { competencyArea: 'Sealing & Weatherproofing', question: 'Explain your approach to applying sealants and weatherstripping for watertight installations.' },
    { competencyArea: 'Measurement & Template', question: 'How do you take site measurements and create templates for fabrication? Describe your accuracy methods.' },
  ],
  'safety-officer': [
    { competencyArea: 'Risk Assessment', question: 'Describe your process for conducting a workplace risk assessment. Give a specific example.' },
    { competencyArea: 'Incident Investigation', question: 'Walk through your methodology for investigating an accident or near-miss incident.' },
    { competencyArea: 'HSE Management Systems', question: 'Describe your experience implementing or maintaining HSE management systems (ISO 45001, OHSAS).' },
    { competencyArea: 'Permit to Work', question: 'How do you manage permit-to-work systems for hot work, confined space, and working at heights?' },
    { competencyArea: 'Emergency Preparedness', question: 'Describe how you develop and drill emergency response plans. Give a specific example.' },
    { competencyArea: 'Regulatory Compliance', question: 'What OSHA, NEBOSH, or local safety regulations do you ensure compliance with? How do you stay current?' },
  ],
  cook: [
    { competencyArea: 'Food Preparation', question: 'Describe your knife skills and cutting techniques. How do you organize your mise en place?' },
    { competencyArea: 'Cooking Methods', question: 'Which cooking methods (grilling, roasting, frying, steaming) are you most proficient in? Give examples.' },
    { competencyArea: 'Menu Planning', question: 'Describe your approach to menu planning. How do you balance nutrition, cost, and variety?' },
    { competencyArea: 'Food Safety & Hygiene', question: 'Explain your knowledge of HACCP principles, food storage requirements, and temperature control.' },
    { competencyArea: 'Stock & Sauce Making', question: 'Describe your technique for preparing stocks, mother sauces, and dressings from scratch.' },
    { competencyArea: 'Kitchen Management', question: 'How do you organize a kitchen? Describe your experience with costing, inventory, and portion control.' },
  ],
  'ac-technician': [
    { competencyArea: 'Split AC Installation', question: 'Walk through your process for installing a split AC system from start to commissioning.' },
    { competencyArea: 'Central AC Systems', question: 'Describe your knowledge of chilled water and central AC systems. What components have you serviced?' },
    { competencyArea: 'Refrigerant Charging', question: 'Explain your procedure for refrigerant recovery, system evacuation, and charging.' },
    { competencyArea: 'Electrical Troubleshooting', question: 'How do you diagnose electrical faults in AC units? Walk through a common scenario.' },
    { competencyArea: 'Compressor Service', question: 'Describe your experience diagnosing compressor faults and performing replacements.' },
    { competencyArea: 'Preventive Maintenance', question: 'What does your AC preventive maintenance schedule include? Describe a typical PM service.' },
  ],
};

// Issue #3: Default rubric criteria per trade
const DEMO_RUBRIC_TEMPLATES = {
  default: [
    { criterion: 'Tool Selection & Handling', description: 'Correct selection and safe handling of trade-specific tools' },
    { criterion: 'Material Knowledge', description: 'Understanding of materials, their properties, and appropriate selection' },
    { criterion: 'Work Technique', description: 'Proper execution of trade-specific techniques and methods' },
    { criterion: 'Safety Compliance', description: 'Adherence to safety protocols, PPE usage, and hazard awareness' },
    { criterion: 'Measurement Accuracy', description: 'Precision in measurements, leveling, and alignment' },
    { criterion: 'Work Quality & Finish', description: 'Overall quality and professional finish of completed work' },
    { criterion: 'Time Management', description: 'Efficient use of time and ability to work within deadlines' },
    { criterion: 'Cleanup & Organization', description: 'Proper cleanup, waste disposal, and site organization' },
  ],
  mason: [
    { criterion: 'Foundation Layout', description: 'Accurate setting out and leveling of foundations and footings' },
    { criterion: 'Brick/Block Laying', description: 'Correct bonding pattern, consistent joint thickness, and plumb alignment' },
    { criterion: 'Mortar Preparation', description: 'Proper mix ratio, consistency, and workability of mortar' },
    { criterion: 'Plastering Finish', description: 'Smooth, even plaster application with consistent thickness' },
    { criterion: 'Level & Plumb Accuracy', description: 'Use of spirit level, plumb bob, and string line for alignment' },
    { criterion: 'Corner & Joint Construction', description: 'Clean corners, proper bonding at junctions, and wall ties' },
    { criterion: 'Safety Compliance', description: 'Correct PPE use, scaffold safety, and manual handling technique' },
    { criterion: 'Workspace Organization', description: 'Clean work area, organized materials, and proper waste disposal' },
  ],
  electrician: [
    { criterion: 'Cable Selection & Routing', description: 'Correct cable sizing, type selection, and neat routing/clipping' },
    { criterion: 'Connection Quality', description: 'Secure, clean terminations and connections with proper torque' },
    { criterion: 'Distribution Board Assembly', description: 'Correct breaker sizing, labeling, and neat wiring within panels' },
    { criterion: 'Earthing & Bonding', description: 'Proper earth connections, bonding conductors, and RCD protection' },
    { criterion: 'Testing Procedures', description: 'Correct use of insulation resistance, continuity, and loop impedance testers' },
    { criterion: 'Code Compliance', description: 'Adherence to electrical codes, color coding, and regulations' },
    { criterion: 'Safety Practices', description: 'Lock-out/tag-out, voltage testing, and PPE compliance' },
    { criterion: 'Documentation', description: 'Accurate completion of test certificates and circuit schedules' },
  ],
  welder: [
    { criterion: 'Joint Preparation', description: 'Correct bevel angle, root gap, and cleanliness of weld preparation' },
    { criterion: 'Welding Technique', description: 'Consistent travel speed, arc length, and electrode manipulation' },
    { criterion: 'Weld Appearance', description: 'Uniform bead profile, consistent width, and proper reinforcement' },
    { criterion: 'Defect-Free Execution', description: 'Absence of porosity, undercut, slag inclusion, and lack of fusion' },
    { criterion: 'Parameter Setting', description: 'Correct amperage, voltage, wire speed, and gas flow selection' },
    { criterion: 'Multi-Position Welding', description: 'Ability to weld in flat, horizontal, vertical, and overhead positions' },
    { criterion: 'Safety Compliance', description: 'Proper welding helmet, gloves, fire watch, and fume extraction use' },
    { criterion: 'Post-Weld Cleanup', description: 'Proper slag removal, grinding, and visual inspection of completed welds' },
  ],
  plumber: [
    { criterion: 'Pipe Cutting & Preparation', description: 'Clean, square cuts with proper deburring and chamfering' },
    { criterion: 'Joint Assembly', description: 'Leak-free joints using appropriate method (solvent, threaded, fusion)' },
    { criterion: 'Slope & Grade Accuracy', description: 'Correct fall on drainage pipes verified with level or laser' },
    { criterion: 'Fixture Installation', description: 'Secure mounting, proper connections, and functional operation of fixtures' },
    { criterion: 'Pressure Testing', description: 'Correct test procedure, holding pressure, and leak identification' },
    { criterion: 'Venting System', description: 'Proper vent pipe sizing, routing, and termination' },
    { criterion: 'Safety Practices', description: 'PPE use, hot work precautions, and confined space awareness' },
    { criterion: 'System Commissioning', description: 'Proper flushing, testing, and handover of completed system' },
  ],
  carpenter: [
    { criterion: 'Measurement & Marking', description: 'Precise measurements, accurate marking, and consistent layout' },
    { criterion: 'Cutting Accuracy', description: 'Clean, square cuts with saw following waste side of line' },
    { criterion: 'Joint Construction', description: 'Tight-fitting joints with correct technique (mortise, dovetail, lap)' },
    { criterion: 'Assembly & Fastening', description: 'Secure assembly using appropriate fasteners and adhesives' },
    { criterion: 'Surface Finish', description: 'Smooth planed surfaces, sanded edges, and professional appearance' },
    { criterion: 'Tool Handling', description: 'Safe and proficient use of hand and power tools' },
    { criterion: 'Safety Compliance', description: 'Dust extraction use, PPE compliance, and safe work practices' },
    { criterion: 'Project Completion', description: 'Finished product meets specifications, dimensions, and quality standards' },
  ],
  'steel-fixer': [
    { criterion: 'BBS Interpretation', description: 'Correct reading and interpretation of bar bending schedules' },
    { criterion: 'Bar Cutting Accuracy', description: 'Bars cut to specified lengths with clean cuts' },
    { criterion: 'Bending Precision', description: 'Correct bend radius, angles, and hook dimensions as per schedule' },
    { criterion: 'Cage Assembly', description: 'Properly tied reinforcement cages with correct spacing and orientation' },
    { criterion: 'Cover Maintenance', description: 'Correct spacer placement ensuring specified concrete cover' },
    { criterion: 'Lap & Splice Placement', description: 'Correct lap lengths and staggered splice positions' },
    { criterion: 'Safety Compliance', description: 'PPE use, manual handling technique, and rebar cap installation' },
    { criterion: 'Quality Verification', description: 'Self-checking of dimensions, cover, and bar positions before pour' },
  ],
  painter: [
    { criterion: 'Surface Preparation', description: 'Thorough cleaning, sanding, filling, and priming of surfaces' },
    { criterion: 'Masking & Protection', description: 'Clean masking lines, covered surfaces, and protected fixtures' },
    { criterion: 'Paint Application', description: 'Even coverage, consistent film thickness, and no runs or sags' },
    { criterion: 'Cutting-In Precision', description: 'Clean, straight lines at edges, corners, and transitions' },
    { criterion: 'Color Consistency', description: 'Uniform color with no patches, streaks, or visible roller marks' },
    { criterion: 'Spray Technique', description: 'Correct spray distance, overlap, and pattern for even coverage' },
    { criterion: 'Safety Compliance', description: 'Proper ventilation, respirator use, and solvent handling' },
    { criterion: 'Finish Quality', description: 'Professional final appearance free of defects, drips, and brush marks' },
  ],
  hvac: [
    { criterion: 'Unit Mounting & Leveling', description: 'Secure mounting of indoor/outdoor units with proper leveling' },
    { criterion: 'Pipe Connection', description: 'Leak-free refrigerant pipe connections with proper flaring/brazing' },
    { criterion: 'Electrical Wiring', description: 'Correct power and control wiring with proper terminations' },
    { criterion: 'Vacuum & Charging', description: 'Proper system evacuation and accurate refrigerant charging' },
    { criterion: 'Ductwork Installation', description: 'Sealed duct connections, proper support, and insulation' },
    { criterion: 'System Testing', description: 'Temperature differential, airflow, and pressure verification' },
    { criterion: 'Safety Compliance', description: 'Refrigerant handling safety, electrical isolation, and PPE use' },
    { criterion: 'Commissioning Report', description: 'Complete documentation of system parameters and test results' },
  ],
  'pipe-fitter': [
    { criterion: 'Pipe Measurement & Cutting', description: 'Accurate measurement with clean, square, and beveled cuts' },
    { criterion: 'Flange Assembly', description: 'Correct gasket selection, bolt pattern, and torque sequence' },
    { criterion: 'Pipe Alignment', description: 'Proper alignment of pipes with no forced fit or stress' },
    { criterion: 'Weld Preparation', description: 'Correct bevel angle, root gap, and tack weld placement' },
    { criterion: 'Support & Hanger Installation', description: 'Proper pipe support spacing, type, and secure installation' },
    { criterion: 'Pressure Test Execution', description: 'Correct test medium, pressure, hold time, and documentation' },
    { criterion: 'Safety Compliance', description: 'PTW adherence, confined space protocols, and PPE use' },
    { criterion: 'Isometric Compliance', description: 'Installed pipework matches isometric drawings and specifications' },
  ],
  scaffolder: [
    { criterion: 'Base & Foundation Setup', description: 'Correct base plate placement, sole boards, and leveling' },
    { criterion: 'Standard & Ledger Assembly', description: 'Plumb standards, level ledgers, and secure coupler tightening' },
    { criterion: 'Bracing & Stability', description: 'Correct diagonal bracing pattern and cross-bracing installation' },
    { criterion: 'Tie Installation', description: 'Proper tie pattern, tie types, and secure anchor points' },
    { criterion: 'Platform & Access', description: 'Full boarding, toe boards, guard rails, and ladder access' },
    { criterion: 'Working at Height Safety', description: 'Harness use, tool lanyards, and edge protection compliance' },
    { criterion: 'Load Assessment', description: 'Correct scaffold class determination and load signage' },
    { criterion: 'Inspection & Tagging', description: 'Thorough inspection with proper scaffold tag completion' },
  ],
  rigger: [
    { criterion: 'Sling Selection & Inspection', description: 'Correct sling type, capacity, and pre-use inspection' },
    { criterion: 'Load Weight Calculation', description: 'Accurate weight estimation using dimensions and material density' },
    { criterion: 'Rigging Configuration', description: 'Correct sling angles, choke points, and balance for the load' },
    { criterion: 'Signal Communication', description: 'Clear, correct hand signals and radio communication with crane operator' },
    { criterion: 'Lift Execution', description: 'Smooth lift, controlled swing, and precise placement of load' },
    { criterion: 'Hardware Usage', description: 'Correct shackle pin orientation, hook latches, and equipment selection' },
    { criterion: 'Safety Zone Management', description: 'Proper exclusion zones, tag lines, and personnel awareness' },
    { criterion: 'Post-Lift Procedures', description: 'Correct gear stowage, inspection, and lift documentation' },
  ],
  'crane-operator': [
    { criterion: 'Pre-Operation Inspection', description: 'Thorough daily inspection of crane components and safety devices' },
    { criterion: 'Setup & Outrigger Deployment', description: 'Level crane setup with correct outrigger extension and ground conditions assessment' },
    { criterion: 'Load Chart Application', description: 'Correct interpretation and application of load charts for planned lifts' },
    { criterion: 'Smooth Crane Control', description: 'Controlled hoist, slew, and trolley movements without shock loading' },
    { criterion: 'Load Placement Accuracy', description: 'Precise positioning and landing of loads at designated locations' },
    { criterion: 'Communication', description: 'Clear response to signals and effective communication with ground crew' },
    { criterion: 'Safety Systems Awareness', description: 'Monitoring of LMI, anti-two-block, and wind speed indicators' },
    { criterion: 'Shutdown & Securing', description: 'Proper crane shutdown procedure, boom stowage, and securing' },
  ],
  'heavy-driver': [
    { criterion: 'Pre-Trip Inspection', description: 'Thorough walk-around inspection checking tires, lights, fluids, and brakes' },
    { criterion: 'Vehicle Start & Control', description: 'Smooth engine start, gear selection, and clutch/brake operation' },
    { criterion: 'Road Maneuvering', description: 'Safe lane changes, intersection navigation, and speed management' },
    { criterion: 'Reversing Skill', description: 'Controlled reversing with proper mirror use and spotter communication' },
    { criterion: 'Load Securing', description: 'Correct use of chains, straps, and dunnage for secure load transport' },
    { criterion: 'Defensive Driving', description: 'Maintained safe following distance, hazard anticipation, and awareness' },
    { criterion: 'Regulatory Compliance', description: 'Adherence to speed limits, weight restrictions, and hours of service' },
    { criterion: 'Post-Trip Procedures', description: 'Proper parking, shutdown, and vehicle condition reporting' },
  ],
  'shuttering-carpenter': [
    { criterion: 'Formwork Layout', description: 'Accurate setting out from drawings with correct dimensions and positions' },
    { criterion: 'Panel Assembly', description: 'Strong panel construction with correct stiffener spacing and alignment' },
    { criterion: 'Alignment & Leveling', description: 'Plumb, level, and square formwork verified with instruments' },
    { criterion: 'Propping & Bracing', description: 'Secure props at correct spacing with adequate bracing for loads' },
    { criterion: 'Surface Finish Preparation', description: 'Clean formwork surfaces with proper release agent application' },
    { criterion: 'Joint & Sealing', description: 'Tight joints between panels to prevent grout leakage' },
    { criterion: 'Safety Compliance', description: 'Working-at-height compliance, PPE use, and fall protection' },
    { criterion: 'Stripping Quality', description: 'Careful removal without damage to concrete or reusable formwork' },
  ],
  'tile-fixer': [
    { criterion: 'Surface Preparation', description: 'Clean, level substrate with proper waterproofing where required' },
    { criterion: 'Layout & Setting Out', description: 'Balanced tile layout with consistent spacing and datum alignment' },
    { criterion: 'Adhesive Application', description: 'Correct trowel notch, full bed coverage, and open time management' },
    { criterion: 'Tile Cutting', description: 'Clean, accurate cuts including curves and notches for fittings' },
    { criterion: 'Alignment & Leveling', description: 'Flat tile surface with consistent joint widths and no lippage' },
    { criterion: 'Grouting Quality', description: 'Full joint fill, clean grout lines, and proper sponge finishing' },
    { criterion: 'Detail Work', description: 'Clean edges, corners, trim pieces, and penetration finishing' },
    { criterion: 'Cleanup & Protection', description: 'Residue-free surface, protected work, and clean work area' },
  ],
  'duct-fabricator': [
    { criterion: 'Pattern Development', description: 'Accurate flat pattern layout from drawings with correct allowances' },
    { criterion: 'Cutting Precision', description: 'Clean, accurate cuts on sheet metal with correct dimensions' },
    { criterion: 'Forming & Bending', description: 'Consistent bends at correct angles with no distortion or cracking' },
    { criterion: 'Seam Assembly', description: 'Tight, air-sealed seams (Pittsburgh, snap-lock, TDF) per specification' },
    { criterion: 'Fitting Fabrication', description: 'Accurate elbows, transitions, and offsets matching design requirements' },
    { criterion: 'Reinforcement', description: 'Correct cross-break, standing seam, or angle reinforcement per duct class' },
    { criterion: 'Safety Compliance', description: 'Machine guarding awareness, cut-resistant gloves, and safe handling' },
    { criterion: 'Dimensional Accuracy', description: 'Finished ductwork within specified tolerances and leak class' },
  ],
  'auto-mechanic': [
    { criterion: 'Diagnostic Process', description: 'Systematic fault diagnosis using scanners, meters, and logical reasoning' },
    { criterion: 'Brake Service', description: 'Correct pad/shoe replacement, rotor measurement, and bleeding technique' },
    { criterion: 'Suspension Work', description: 'Proper component replacement, torque specs, and alignment check' },
    { criterion: 'Electrical Diagnosis', description: 'Correct use of multimeter, wiring diagrams, and circuit testing' },
    { criterion: 'Engine Service', description: 'Proper timing, valve adjustment, and gasket replacement technique' },
    { criterion: 'Fluid Service', description: 'Correct fluid types, capacities, and fill/bleed procedures' },
    { criterion: 'Safety Compliance', description: 'Jack stand use, battery disconnect, and chemical handling safety' },
    { criterion: 'Test Drive & Verification', description: 'Post-repair verification, test drive, and quality assurance' },
  ],
  'diesel-mechanic': [
    { criterion: 'Engine Inspection', description: 'Systematic visual and diagnostic inspection of diesel engine components' },
    { criterion: 'Fuel System Service', description: 'Correct injector testing, filter replacement, and fuel system priming' },
    { criterion: 'Turbocharger Inspection', description: 'Proper shaft play check, boost pressure verification, and housing inspection' },
    { criterion: 'Cooling System Service', description: 'Pressure testing, thermostat check, and coolant replacement procedure' },
    { criterion: 'Hydraulic Diagnosis', description: 'Pressure testing, flow testing, and component inspection technique' },
    { criterion: 'Scheduled Maintenance', description: 'Complete PM checklist execution including fluids, filters, and adjustments' },
    { criterion: 'Safety Compliance', description: 'LOTO procedures, hot surface awareness, and chemical handling safety' },
    { criterion: 'Documentation & Reporting', description: 'Accurate service records, fault codes, and maintenance documentation' },
  ],
  fabricator: [
    { criterion: 'Marking & Layout', description: 'Accurate marking from drawings with correct reference points and dimensions' },
    { criterion: 'Cutting Quality', description: 'Clean, accurate cuts with specified method (oxy-fuel, plasma, mechanical)' },
    { criterion: 'Fitting & Assembly', description: 'Correct component alignment, clamping, and tack welding for assembly' },
    { criterion: 'Bolted Connection Assembly', description: 'Correct bolt grade, washer placement, and torque application' },
    { criterion: 'Dimensional Accuracy', description: 'Fabricated components within specified tolerances' },
    { criterion: 'Surface Preparation', description: 'Proper grinding, deburring, and surface finish as specified' },
    { criterion: 'Safety Compliance', description: 'PPE use, machine guarding awareness, and safe lifting technique' },
    { criterion: 'Quality Inspection', description: 'Self-inspection of dimensions, fit, and finish before handover' },
  ],
  'insulation-worker': [
    { criterion: 'Material Preparation', description: 'Correct cutting and shaping of insulation materials to fit' },
    { criterion: 'Insulation Application', description: 'Tight-fitting insulation with no gaps, compression, or voids' },
    { criterion: 'Joint & Seam Sealing', description: 'Proper adhesive/tape application at all joints and seams' },
    { criterion: 'Vapor Barrier Installation', description: 'Continuous vapor barrier with sealed overlaps on cold systems' },
    { criterion: 'Cladding & Jacketing', description: 'Neat metal cladding with proper overlaps, screws, and weatherproofing' },
    { criterion: 'Thickness Verification', description: 'Installed insulation meets specified thickness requirements' },
    { criterion: 'Safety Compliance', description: 'PPE use including respirator, gloves, and protective clothing' },
    { criterion: 'Finish Quality', description: 'Professional appearance with neat cladding, banding, and labeling' },
  ],
  'heavy-equipment-operator': [
    { criterion: 'Pre-Operation Inspection', description: 'Thorough walk-around inspection and cab checks before start-up' },
    { criterion: 'Machine Start-Up', description: 'Correct start-up sequence, warm-up, and system checks' },
    { criterion: 'Basic Operations', description: 'Smooth control of boom, bucket, slew, and travel functions' },
    { criterion: 'Trenching/Excavation', description: 'Accurate trench dimensions, batter angles, and depth control' },
    { criterion: 'Grade Work', description: 'Achieving specified levels and grades with smooth finish' },
    { criterion: 'Material Handling', description: 'Safe loading, stockpiling, and material movement' },
    { criterion: 'Safety Compliance', description: 'Exclusion zone awareness, spotter use, and site traffic rules' },
    { criterion: 'Shutdown & Parking', description: 'Correct shutdown sequence, parking position, and securing' },
  ],
  'aluminium-fabricator': [
    { criterion: 'Profile Cutting', description: 'Clean, accurate cuts at correct angles with no burrs' },
    { criterion: 'Frame Assembly', description: 'Square, tight-fitting frame assembly with correct corner connections' },
    { criterion: 'Hardware Installation', description: 'Correct placement and secure fixing of handles, locks, and hinges' },
    { criterion: 'Glass Installation', description: 'Safe glass handling with correct glazing beads and rubber seals' },
    { criterion: 'Sealing & Weatherproofing', description: 'Continuous sealant application with no gaps or voids' },
    { criterion: 'Measurement Accuracy', description: 'Fabricated frames match site dimensions within tolerance' },
    { criterion: 'Safety Compliance', description: 'Cut-resistant gloves, eye protection, and safe glass handling' },
    { criterion: 'Finish Quality', description: 'Smooth operation, clean appearance, and proper weather sealing' },
  ],
  'safety-officer': [
    { criterion: 'Risk Assessment Execution', description: 'Systematic hazard identification, risk rating, and control measures' },
    { criterion: 'Site Inspection', description: 'Thorough site walk-through identifying hazards and non-compliances' },
    { criterion: 'Incident Investigation', description: 'Structured investigation methodology with root cause analysis' },
    { criterion: 'Toolbox Talk Delivery', description: 'Clear, engaging safety briefing with relevant content and worker interaction' },
    { criterion: 'PTW Management', description: 'Correct permit completion, verification of controls, and closeout' },
    { criterion: 'Emergency Drill Execution', description: 'Organized drill with proper communication, assembly, and headcount' },
    { criterion: 'Documentation', description: 'Accurate, complete safety records, reports, and compliance documentation' },
    { criterion: 'Regulatory Knowledge', description: 'Demonstrated knowledge of applicable codes, standards, and regulations' },
  ],
  cook: [
    { criterion: 'Knife Skills', description: 'Correct grip, cutting techniques, and consistent product size' },
    { criterion: 'Cooking Technique', description: 'Proper heat control, timing, and method execution' },
    { criterion: 'Flavor & Seasoning', description: 'Balanced seasoning, proper tasting, and flavor development' },
    { criterion: 'Food Presentation', description: 'Attractive plating, portioning, and garnish application' },
    { criterion: 'Food Safety & Hygiene', description: 'Handwashing, temperature control, cross-contamination prevention' },
    { criterion: 'Kitchen Organization', description: 'Clean, organized workstation with efficient mise en place' },
    { criterion: 'Time Management', description: 'Multiple tasks coordinated with dishes completed on time' },
    { criterion: 'Waste Management', description: 'Minimal food waste, proper disposal, and recycling practices' },
  ],
  'ac-technician': [
    { criterion: 'Unit Installation', description: 'Secure mounting, leveling, and positioning of AC indoor/outdoor units' },
    { criterion: 'Copper Pipe Work', description: 'Clean flaring, correct bending radius, and leak-free connections' },
    { criterion: 'Electrical Connection', description: 'Correct wiring, termination, and earth connection per diagram' },
    { criterion: 'Vacuum & Leak Test', description: 'Proper system evacuation and nitrogen/electronic leak detection' },
    { criterion: 'Refrigerant Charging', description: 'Accurate charging by weight or superheat/subcooling method' },
    { criterion: 'Drainage Installation', description: 'Correct condensate drain slope, trap, and termination' },
    { criterion: 'Safety Compliance', description: 'Electrical isolation, refrigerant handling safety, and PPE use' },
    { criterion: 'System Commissioning', description: 'Temperature verification, airflow check, and operational testing' },
  ],
};

// Gap 7: Pre-screening self-assessment templates per trade
const PRE_SCREENING_TEMPLATES = {
  default: [
    { area: 'Core Trade Skills', question: 'Rate your overall proficiency in your primary trade tasks.' },
    { area: 'Safety & Compliance', question: 'Rate your knowledge of safety procedures and PPE requirements.' },
    { area: 'Tools & Equipment', question: 'Rate your proficiency with specialized tools and equipment.' },
    { area: 'Blueprint Reading', question: 'Rate your ability to read construction drawings and specifications.' },
    { area: 'Quality Standards', question: 'Rate your understanding of quality standards and measurement techniques.' },
    { area: 'Problem Solving', question: 'Rate your ability to troubleshoot and solve on-site challenges.' },
    { area: 'Material Knowledge', question: 'Rate your knowledge of materials, their properties, and appropriate selection.' },
    { area: 'Time Management', question: 'Rate your ability to manage time and work within deadlines.' },
  ],
  mason: [
    { area: 'Foundation Laying', question: 'Rate your experience in laying foundations and footings.' },
    { area: 'Brick & Block Bonding', question: 'Rate your proficiency in different brick bonding patterns.' },
    { area: 'Plastering', question: 'Rate your plastering skills (internal and external).' },
    { area: 'Leveling & Alignment', question: 'Rate your ability to use leveling instruments and maintain alignment.' },
    { area: 'Mortar Mixing', question: 'Rate your knowledge of mortar types and mixing ratios.' },
    { area: 'Safety Compliance', question: 'Rate your knowledge of masonry safety procedures.' },
    { area: 'Blueprint Reading', question: 'Rate your ability to read masonry-specific drawings.' },
    { area: 'Material Selection', question: 'Rate your knowledge of brick/block types and their applications.' },
  ],
  electrician: [
    { area: 'Wiring Installation', question: 'Rate your experience in residential/commercial wiring.' },
    { area: 'Circuit Design', question: 'Rate your ability to design and plan electrical circuits.' },
    { area: 'Safety & Grounding', question: 'Rate your knowledge of electrical safety and grounding.' },
    { area: 'Panel Installation', question: 'Rate your experience with distribution board installation.' },
    { area: 'Testing & Measurement', question: 'Rate your proficiency with electrical testing instruments.' },
    { area: 'Code Compliance', question: 'Rate your knowledge of electrical codes and standards.' },
    { area: 'Troubleshooting', question: 'Rate your ability to diagnose electrical faults.' },
    { area: 'Motor Controls', question: 'Rate your experience with motor starters and controls.' },
  ],
  welder: [
    { area: 'SMAW/Stick Welding', question: 'Rate your ability to perform shielded metal arc welding on mild steel' },
    { area: 'MIG/MAG Welding', question: 'Rate your competency in gas metal arc welding operations' },
    { area: 'TIG Welding', question: 'Rate your ability to perform gas tungsten arc welding' },
    { area: 'Welding Joint Preparation', question: 'Rate your skills in beveling, grinding, and joint fit-up' },
    { area: 'Blueprint & WPS Reading', question: 'Rate your ability to read welding procedure specifications and symbols' },
    { area: 'Welding Safety & PPE', question: 'Rate your knowledge of welding hazards, fume extraction, and PPE use' },
    { area: 'Visual & NDT Inspection', question: 'Rate your ability to identify weld defects (porosity, undercut, slag)' },
    { area: 'Material Identification', question: 'Rate your knowledge of base metals, filler rods, and electrodes' },
  ],
  plumber: [
    { area: 'Pipe Joining Methods', question: 'Rate your competency in solvent cement, threaded, PPR fusion, and compression joints' },
    { area: 'Drainage Systems', question: 'Rate your ability to install DWV systems with proper slope and venting' },
    { area: 'Water Supply Systems', question: 'Rate your skills in hot/cold water supply pipe installation' },
    { area: 'Fixture Installation', question: 'Rate your competency in installing toilets, basins, showers, and water heaters' },
    { area: 'Pipe Cutting & Threading', question: 'Rate your ability to cut, ream, and thread various pipe materials' },
    { area: 'Code Compliance', question: 'Rate your knowledge of plumbing codes and standards (PBC, BS EN 12056)' },
    { area: 'Leak Detection & Repair', question: 'Rate your skills in pressure testing and leak diagnosis' },
    { area: 'Safety & Confined Spaces', question: 'Rate your knowledge of plumbing safety and confined space protocols' },
  ],
  carpenter: [
    { area: 'Wood Selection & Treatment', question: 'Rate your knowledge of timber types, grading, and preservation' },
    { area: 'Hand Tool Proficiency', question: 'Rate your skill with saws, chisels, planes, and marking tools' },
    { area: 'Power Tool Operation', question: 'Rate your competency with circular saws, routers, and planers' },
    { area: 'Joinery Techniques', question: 'Rate your ability to create mortise-tenon, dovetail, and lap joints' },
    { area: 'Formwork Construction', question: 'Rate your skills in building concrete formwork and shuttering' },
    { area: 'Measurement & Layout', question: 'Rate your accuracy in measuring, marking, and leveling' },
    { area: 'Door & Window Fitting', question: 'Rate your competency in installing doors, windows, and frames' },
    { area: 'Workshop Safety', question: 'Rate your knowledge of carpentry safety, dust extraction, and PPE' },
  ],
  'steel-fixer': [
    { area: 'Bar Bending Schedules', question: 'Rate your ability to read and prepare BBS as per BS 8666' },
    { area: 'Rebar Cutting & Bending', question: 'Rate your skill in cutting and bending reinforcement bars to spec' },
    { area: 'Rebar Tying & Placement', question: 'Rate your competency in placing and tying reinforcement cages' },
    { area: 'Cover & Spacer Installation', question: 'Rate your ability to maintain correct concrete cover' },
    { area: 'Lap Length Calculation', question: 'Rate your knowledge of lap lengths and splice positions' },
    { area: 'Foundation Reinforcement', question: 'Rate your skills in reinforcing foundations, footings, and rafts' },
    { area: 'Column & Beam Reinforcement', question: 'Rate your competency in vertical and horizontal structural reinforcement' },
    { area: 'Site Safety & Load Handling', question: 'Rate your knowledge of manual handling and site safety for steel' },
  ],
  painter: [
    { area: 'Surface Preparation', question: 'Rate your skills in cleaning, sanding, filling, and priming surfaces' },
    { area: 'Paint Selection', question: 'Rate your knowledge of paint types (distemper, emulsion, enamel, epoxy)' },
    { area: 'Brush & Roller Application', question: 'Rate your competency in brush and roller painting techniques' },
    { area: 'Spray Painting', question: 'Rate your ability to operate airless and HVLP spray equipment' },
    { area: 'Color Mixing & Matching', question: 'Rate your skills in color theory, tinting, and shade matching' },
    { area: 'Decorative Finishes', question: 'Rate your ability to apply texture, stencil, and faux finishes' },
    { area: 'Protective Coatings', question: 'Rate your knowledge of anti-corrosion and industrial coatings' },
    { area: 'Safety & Hazard Management', question: 'Rate your knowledge of paint hazards, ventilation, and PPE' },
  ],
  hvac: [
    { area: 'Refrigeration Cycle', question: 'Rate your understanding of the vapor compression refrigeration cycle' },
    { area: 'AC Installation', question: 'Rate your competency in split and package AC unit installation' },
    { area: 'Ductwork Design', question: 'Rate your ability to fabricate and install HVAC ductwork' },
    { area: 'Electrical Controls', question: 'Rate your skills with thermostats, contactors, and control circuits' },
    { area: 'Refrigerant Handling', question: 'Rate your knowledge of refrigerant types, charging, and recovery' },
    { area: 'Troubleshooting', question: 'Rate your ability to diagnose HVAC faults using gauges and meters' },
    { area: 'Ventilation Systems', question: 'Rate your competency in exhaust, supply, and balanced ventilation' },
    { area: 'Safety & Regulations', question: 'Rate your knowledge of HVAC safety, F-gas regulations, and ASHRAE standards' },
  ],
  'pipe-fitter': [
    { area: 'Pipe Fabrication', question: 'Rate your skills in cutting, beveling, and fitting industrial pipes' },
    { area: 'Flange Connections', question: 'Rate your competency in assembling flanged joints with proper gaskets and torque' },
    { area: 'Welded Pipe Systems', question: 'Rate your ability to prepare pipe for butt and socket welds' },
    { area: 'Isometric Drawings', question: 'Rate your skill in reading pipe isometric and spool drawings' },
    { area: 'Pressure Testing', question: 'Rate your competency in hydrostatic and pneumatic pressure testing' },
    { area: 'Valve & Fitting Installation', question: 'Rate your knowledge of valve types and correct installation' },
    { area: 'Material Standards', question: 'Rate your knowledge of pipe schedules, materials (CS, SS, alloy)' },
    { area: 'Confined Space & Hot Work', question: 'Rate your awareness of permit-to-work and confined space procedures' },
  ],
  scaffolder: [
    { area: 'Tube & Fitting Scaffolding', question: 'Rate your competency in erecting tube and fitting scaffolds' },
    { area: 'System Scaffolding', question: 'Rate your skills with modular/system scaffold (Cuplock, Ringlock)' },
    { area: 'Working at Heights', question: 'Rate your knowledge of fall protection and harness use' },
    { area: 'Load Calculations', question: 'Rate your understanding of scaffold load classes (1-6) and SWL' },
    { area: 'Scaffold Inspection', question: 'Rate your ability to inspect scaffolds and issue scaffold tags' },
    { area: 'Tie Patterns & Bracing', question: 'Rate your knowledge of tie patterns, bracing, and stability' },
    { area: 'Dismantling Procedures', question: 'Rate your competency in safe scaffold dismantling sequence' },
    { area: 'Method Statements', question: 'Rate your ability to follow risk assessments and method statements' },
  ],
  rigger: [
    { area: 'Sling Selection', question: 'Rate your knowledge of sling types (wire rope, chain, webbing) and WLL' },
    { area: 'Load Weight Estimation', question: 'Rate your ability to calculate load weights from dimensions and materials' },
    { area: 'Rigging Hardware', question: 'Rate your competency with shackles, eyebolts, spreader beams, and hooks' },
    { area: 'Crane Signal Communication', question: 'Rate your knowledge of standard hand signals and radio communication' },
    { area: 'Lift Planning', question: 'Rate your ability to develop rigging plans for routine and complex lifts' },
    { area: 'Equipment Inspection', question: 'Rate your skills in pre-use inspection and certification checking' },
    { area: 'Multi-Crane Operations', question: 'Rate your understanding of tandem lift procedures' },
    { area: 'Safety & PTW Systems', question: 'Rate your knowledge of permit-to-work and exclusion zones' },
  ],
  'crane-operator': [
    { area: 'Mobile Crane Operation', question: 'Rate your competency in operating mobile/hydraulic cranes' },
    { area: 'Tower Crane Operation', question: 'Rate your skills in operating tower cranes (flat top, luffing)' },
    { area: 'Load Charts', question: 'Rate your ability to read and apply crane load charts correctly' },
    { area: 'Ground Conditions', question: 'Rate your knowledge of ground bearing pressure and outrigger setup' },
    { area: 'Pre-Operation Inspection', question: 'Rate your competency in daily crane inspection procedures' },
    { area: 'Lift Planning', question: 'Rate your understanding of lift plans, radius, and boom length selection' },
    { area: 'Weather Limitations', question: 'Rate your knowledge of wind speed limits and weather restrictions' },
    { area: 'Emergency Procedures', question: 'Rate your knowledge of crane emergency and anti-two-block systems' },
  ],
  'heavy-driver': [
    { area: 'Vehicle Pre-Trip Inspection', question: 'Rate your competency in daily vehicle inspection procedures' },
    { area: 'Defensive Driving', question: 'Rate your knowledge of defensive driving techniques for heavy vehicles' },
    { area: 'Load Securing', question: 'Rate your skills in securing loads with chains, straps, and dunnage' },
    { area: 'Route Planning', question: 'Rate your ability to plan routes considering weight limits and clearances' },
    { area: 'Reversing & Maneuvering', question: 'Rate your skill in reversing, docking, and tight-space maneuvering' },
    { area: 'Vehicle Maintenance', question: 'Rate your knowledge of basic vehicle maintenance and fault reporting' },
    { area: 'Traffic Regulations', question: 'Rate your knowledge of traffic laws, licensing, and hours of service' },
    { area: 'Emergency Response', question: 'Rate your knowledge of accident procedures and first aid basics' },
  ],
  'shuttering-carpenter': [
    { area: 'Column Formwork', question: 'Rate your competency in building column shuttering/formwork' },
    { area: 'Beam & Slab Formwork', question: 'Rate your skills in constructing beam and slab formwork systems' },
    { area: 'Formwork Alignment', question: 'Rate your ability to align and level formwork to specified tolerances' },
    { area: 'Props & Support Systems', question: 'Rate your knowledge of propping systems and load distribution' },
    { area: 'Stripping & Striking', question: 'Rate your competency in safe formwork removal procedures and timing' },
    { area: 'Formwork Materials', question: 'Rate your knowledge of plywood, steel, and aluminum formwork systems' },
    { area: 'Curved & Special Formwork', question: 'Rate your ability to construct non-standard shaped formwork' },
    { area: 'Safety & Access', question: 'Rate your knowledge of working-at-height and formwork safety' },
  ],
  'tile-fixer': [
    { area: 'Floor Tiling', question: 'Rate your competency in laying floor tiles with proper adhesive and spacing' },
    { area: 'Wall Tiling', question: 'Rate your skills in fixing wall tiles with correct bonding method' },
    { area: 'Tile Cutting', question: 'Rate your ability to cut tiles using manual and electric cutters' },
    { area: 'Surface Preparation', question: 'Rate your knowledge of substrate preparation and waterproofing' },
    { area: 'Layout & Pattern Setting', question: 'Rate your skills in planning tile layout, patterns, and datum lines' },
    { area: 'Grouting & Finishing', question: 'Rate your competency in grouting, sealing, and finishing joints' },
    { area: 'Natural Stone Installation', question: 'Rate your experience with marble, granite, and natural stone' },
    { area: 'Material Selection', question: 'Rate your knowledge of tile types, adhesives, and grout selection' },
  ],
  'duct-fabricator': [
    { area: 'Sheet Metal Layout', question: 'Rate your ability to develop flat patterns from duct drawings' },
    { area: 'Cutting & Forming', question: 'Rate your skills with shears, brakes, and roll-forming equipment' },
    { area: 'Joint & Seam Types', question: 'Rate your knowledge of Pittsburgh, snap-lock, and TDF seam types' },
    { area: 'Rectangular Duct Fabrication', question: 'Rate your competency in fabricating rectangular ductwork' },
    { area: 'Round/Spiral Duct Work', question: 'Rate your skills with round duct, elbows, and transitions' },
    { area: 'Duct Sizing & Standards', question: 'Rate your knowledge of duct sizing methods and SMACNA standards' },
    { area: 'Insulation Application', question: 'Rate your ability to apply duct insulation and vapor barriers' },
    { area: 'Shop Safety', question: 'Rate your knowledge of sheet metal shop safety and machine guarding' },
  ],
  'auto-mechanic': [
    { area: 'Engine Diagnostics', question: 'Rate your ability to diagnose engine faults using OBD-II scanners' },
    { area: 'Brake Systems', question: 'Rate your competency in servicing disc and drum brake systems' },
    { area: 'Suspension & Steering', question: 'Rate your skills in diagnosing and repairing suspension components' },
    { area: 'Electrical Systems', question: 'Rate your knowledge of vehicle electrical, charging, and starting systems' },
    { area: 'Transmission Service', question: 'Rate your ability to service manual and automatic transmissions' },
    { area: 'Engine Overhaul', question: 'Rate your competency in engine teardown, inspection, and reassembly' },
    { area: 'AC Systems', question: 'Rate your skills in automotive AC diagnosis and R134a/R1234yf recharge' },
    { area: 'Workshop Safety', question: 'Rate your knowledge of workshop safety, jack stands, and chemical handling' },
  ],
  'diesel-mechanic': [
    { area: 'Diesel Engine Fundamentals', question: 'Rate your understanding of diesel combustion and fuel systems' },
    { area: 'Fuel Injection Systems', question: 'Rate your competency with common rail, unit injector, and mechanical injection' },
    { area: 'Turbocharger Systems', question: 'Rate your ability to inspect and service turbochargers and intercoolers' },
    { area: 'Cooling Systems', question: 'Rate your skills in diagnosing and repairing heavy-duty cooling systems' },
    { area: 'Exhaust After-Treatment', question: 'Rate your knowledge of DPF, SCR, and emissions control systems' },
    { area: 'Hydraulic Systems', question: 'Rate your competency in diagnosing hydraulic pumps, cylinders, and valves' },
    { area: 'Preventive Maintenance', question: 'Rate your ability to perform scheduled PM services and inspections' },
    { area: 'Diagnostic Equipment', question: 'Rate your skills with diagnostic scanners and test equipment' },
  ],
  fabricator: [
    { area: 'Steel Cutting', question: 'Rate your competency in oxy-fuel, plasma, and mechanical cutting methods' },
    { area: 'Structural Steel Assembly', question: 'Rate your skills in fitting and assembling structural steel sections' },
    { area: 'Bolted Connections', question: 'Rate your knowledge of bolt grades, torque specifications, and tensioning' },
    { area: 'Plate Work', question: 'Rate your ability to lay out, cut, and form steel plate components' },
    { area: 'Blueprint Reading', question: 'Rate your skill in reading structural and fabrication drawings' },
    { area: 'Dimensional Control', question: 'Rate your competency in measuring, marking, and dimensional checking' },
    { area: 'Surface Treatment', question: 'Rate your knowledge of sandblasting, priming, and corrosion protection' },
    { area: 'Material Handling & Safety', question: 'Rate your knowledge of material handling, lifting, and shop safety' },
  ],
  'insulation-worker': [
    { area: 'Thermal Insulation', question: 'Rate your competency in installing thermal insulation on pipes and equipment' },
    { area: 'Acoustic Insulation', question: 'Rate your skills in sound insulation materials and installation' },
    { area: 'Cladding & Jacketing', question: 'Rate your ability to install aluminum or stainless steel cladding' },
    { area: 'Material Selection', question: 'Rate your knowledge of insulation materials (mineral wool, foam, fiberglass)' },
    { area: 'Pipe & Vessel Insulation', question: 'Rate your competency in insulating pipes, tanks, and vessels' },
    { area: 'Measurement & Calculation', question: 'Rate your ability to calculate insulation thickness and material quantities' },
    { area: 'Cold Insulation', question: 'Rate your skills in cold/cryogenic insulation and vapor barriers' },
    { area: 'Safety & Hazardous Materials', question: 'Rate your knowledge of asbestos awareness and insulation safety' },
  ],
  'heavy-equipment-operator': [
    { area: 'Excavator Operation', question: 'Rate your competency in operating hydraulic excavators' },
    { area: 'Loader Operation', question: 'Rate your skills in operating wheel loaders and backhoe loaders' },
    { area: 'Bulldozer/Grader Operation', question: 'Rate your ability to operate bulldozers and motor graders' },
    { area: 'Pre-Operation Checks', question: 'Rate your competency in daily machine inspection and walk-around checks' },
    { area: 'Grade & Level Control', question: 'Rate your skills in achieving specified grades and levels' },
    { area: 'Soil & Material Types', question: 'Rate your knowledge of soil types and their effect on operations' },
    { area: 'Site Safety', question: 'Rate your knowledge of exclusion zones, spotters, and site traffic management' },
    { area: 'Basic Maintenance', question: 'Rate your ability to perform daily maintenance (fluids, filters, tracks/tires)' },
  ],
  'aluminium-fabricator': [
    { area: 'Aluminium Profile Cutting', question: 'Rate your competency in cutting aluminium profiles to precise dimensions' },
    { area: 'Window & Door Fabrication', question: 'Rate your skills in fabricating aluminium window and door frames' },
    { area: 'Curtain Wall Systems', question: 'Rate your knowledge of curtain wall assembly and installation' },
    { area: 'Glass Installation', question: 'Rate your ability to handle and install glass panels safely' },
    { area: 'Hardware & Fitting', question: 'Rate your competency in installing handles, locks, and accessories' },
    { area: 'Sealing & Weatherproofing', question: 'Rate your skills in applying sealants and weatherstripping' },
    { area: 'Measurement & Template', question: 'Rate your ability to take site measurements and create templates' },
    { area: 'Workshop & Site Safety', question: 'Rate your knowledge of aluminium fabrication safety and PPE' },
  ],
  'safety-officer': [
    { area: 'Risk Assessment', question: 'Rate your competency in conducting workplace risk assessments' },
    { area: 'Incident Investigation', question: 'Rate your skills in investigating accidents and near-misses' },
    { area: 'HSE Management Systems', question: 'Rate your knowledge of ISO 45001, OHSAS, and HSE management' },
    { area: 'Permit to Work', question: 'Rate your competency in managing PTW systems (hot work, confined space, heights)' },
    { area: 'Emergency Preparedness', question: 'Rate your ability to develop and drill emergency response plans' },
    { area: 'Safety Training Delivery', question: 'Rate your skills in delivering toolbox talks and safety inductions' },
    { area: 'Regulatory Compliance', question: 'Rate your knowledge of OSHA, NEBOSH, OSHAD, and local regulations' },
    { area: 'PPE Management', question: 'Rate your competency in PPE selection, inspection, and enforcement' },
  ],
  cook: [
    { area: 'Food Preparation', question: 'Rate your competency in knife skills, cutting techniques, and mise en place' },
    { area: 'Cooking Methods', question: 'Rate your skills in grilling, roasting, frying, boiling, and steaming' },
    { area: 'Menu Planning', question: 'Rate your ability to plan menus considering nutrition and cost' },
    { area: 'Food Safety & Hygiene', question: 'Rate your knowledge of HACCP, food storage, and temperature control' },
    { area: 'Baking & Pastry', question: 'Rate your competency in baking bread, pastries, and desserts' },
    { area: 'Kitchen Equipment', question: 'Rate your skills in operating and maintaining commercial kitchen equipment' },
    { area: 'Stock & Sauce Making', question: 'Rate your ability to prepare stocks, sauces, and dressings' },
    { area: 'Kitchen Management', question: 'Rate your knowledge of kitchen organization, costing, and portion control' },
  ],
  'ac-technician': [
    { area: 'Split AC Installation', question: 'Rate your competency in installing split and multi-split AC systems' },
    { area: 'Central AC Systems', question: 'Rate your knowledge of chilled water and central AC systems' },
    { area: 'Refrigerant Charging', question: 'Rate your skills in refrigerant recovery, evacuation, and charging' },
    { area: 'Electrical Troubleshooting', question: 'Rate your ability to diagnose electrical faults in AC units' },
    { area: 'Compressor Service', question: 'Rate your competency in compressor diagnosis and replacement' },
    { area: 'Preventive Maintenance', question: 'Rate your skills in AC cleaning, filter replacement, and PM schedules' },
    { area: 'Duct & Airflow', question: 'Rate your knowledge of duct sizing, airflow measurement, and balancing' },
    { area: 'Safety & Regulations', question: 'Rate your knowledge of AC safety, electrical isolation, and F-gas regulations' },
  ],
};

// Helper: update evidence sufficiency flags
function updateEvidenceSufficiency(evidence) {
  const cats = evidence.map(e => e.category);
  return {
    hasExperienceLetter: cats.includes('experience-letter'),
    hasTradeCertificate: cats.includes('trade-certificate'),
    hasReferenceLetter: cats.includes('reference-letter'),
    hasWorkSample: cats.includes('work-sample'),
  };
}

// ═══════════════════════════════════════════════════════════════
// GAP #6: Knowledge Test Templates (per trade)
// Each trade has 10 questions (MCQ, true-false, fill-blank, short-answer)
// ═══════════════════════════════════════════════════════════════
const KNOWLEDGE_TEST_TEMPLATES = {
  default: [
    { question: 'What is the primary purpose of PPE in the workplace?', type: 'mcq', options: ['To look professional', 'To protect against workplace hazards', 'To identify workers by trade', 'To comply with uniform policies'], correctOption: 1, points: 1 },
    { question: 'A risk assessment must be completed before starting any new task.', type: 'true-false', correctAnswer: 'true', points: 1 },
    { question: 'The three elements of the fire triangle are heat, fuel, and _____.', type: 'fill-blank', acceptableAnswers: ['oxygen', 'air', 'O2'], points: 1 },
    { question: 'What does NQF stand for in the context of skills certification?', type: 'short-answer', acceptableAnswers: ['National Qualifications Framework', 'national qualifications framework'], points: 1 },
    { question: 'Which document is typically required to verify work experience for RPL?', type: 'mcq', options: ['Social media profile', 'Experience letter from employer', 'Personal diary', 'Photograph at workplace'], correctOption: 1, points: 1 },
    { question: 'Quality control involves only checking the final product, not the process.', type: 'true-false', correctAnswer: 'false', points: 1 },
    { question: 'The abbreviation OSHA stands for Occupational Safety and _____ Administration.', type: 'fill-blank', acceptableAnswers: ['Health', 'health'], points: 1 },
    { question: 'Name two types of hazards commonly found on construction sites.', type: 'short-answer', acceptableAnswers: ['fall hazards electrical hazards', 'falls and electrocution', 'falling objects electrical'], points: 2 },
    { question: 'What is the correct order: Plan, Do, Check, _____?', type: 'mcq', options: ['Review', 'Act', 'Report', 'Finish'], correctOption: 1, points: 1 },
    { question: 'A competency-based assessment evaluates what a worker can actually _____ in the workplace.', type: 'fill-blank', acceptableAnswers: ['do', 'perform', 'demonstrate'], points: 1 },
  ],
  electrician: [
    { question: 'What is the standard voltage for single-phase residential supply in Pakistan?', type: 'mcq', options: ['110V', '220V', '380V', '440V'], correctOption: 1, points: 1 },
    { question: 'A circuit breaker and a fuse serve the same protective function.', type: 'true-false', correctAnswer: 'true', points: 1 },
    { question: 'The color code for earth/ground wire in international standards is _____ and yellow.', type: 'fill-blank', acceptableAnswers: ['green', 'Green'], points: 1 },
    { question: 'Explain the difference between a series circuit and a parallel circuit.', type: 'short-answer', acceptableAnswers: ['series single path parallel multiple paths', 'series one path parallel branched'], points: 2 },
    { question: 'Which instrument is used to measure electrical resistance?', type: 'mcq', options: ['Ammeter', 'Voltmeter', 'Ohmmeter/Multimeter', 'Wattmeter'], correctOption: 2, points: 1 },
    { question: 'It is safe to work on live electrical circuits if you wear rubber gloves.', type: 'true-false', correctAnswer: 'false', points: 1 },
    { question: 'The unit of electrical power is the _____.', type: 'fill-blank', acceptableAnswers: ['watt', 'Watt', 'W'], points: 1 },
    { question: 'What is the purpose of earthing/grounding in electrical installations?', type: 'short-answer', acceptableAnswers: ['safety protection fault current', 'prevent electric shock', 'directs fault current to ground'], points: 2 },
    { question: 'Which type of cable is recommended for outdoor underground installation?', type: 'mcq', options: ['PVC flat cable', 'Armoured cable (SWA)', 'Flexible cord', 'Twin and earth'], correctOption: 1, points: 1 },
    { question: 'Ohm\'s law states that V = I × _____.', type: 'fill-blank', acceptableAnswers: ['R', 'resistance', 'Resistance'], points: 1 },
  ],
  mason: [
    { question: 'What is the standard mortar mix ratio for general brickwork?', type: 'mcq', options: ['1:2', '1:4', '1:6', '1:8'], correctOption: 2, points: 1 },
    { question: 'English bond is stronger than stretcher bond for load-bearing walls.', type: 'true-false', correctAnswer: 'true', points: 1 },
    { question: 'The tool used to check if a wall is perfectly vertical is called a _____ level or plumb bob.', type: 'fill-blank', acceptableAnswers: ['spirit', 'Spirit', 'bubble'], points: 1 },
    { question: 'Explain why curing is important after concrete or plaster work.', type: 'short-answer', acceptableAnswers: ['prevents cracking maintains moisture strength', 'hydration strength development', 'moisture retention proper strength'], points: 2 },
    { question: 'Which type of cement is used for underwater construction?', type: 'mcq', options: ['OPC', 'White cement', 'Portland Pozzolana Cement', 'Sulfate-resistant cement'], correctOption: 3, points: 1 },
    { question: 'Bricks should be soaked in water before laying to prevent them from absorbing mortar moisture.', type: 'true-false', correctAnswer: 'true', points: 1 },
    { question: 'The horizontal layer of mortar between courses of bricks is called a _____ joint.', type: 'fill-blank', acceptableAnswers: ['bed', 'Bed', 'horizontal'], points: 1 },
    { question: 'What is the minimum overlap for bricks in a stretcher bond?', type: 'short-answer', acceptableAnswers: ['half brick', 'half a brick length', '50%', 'half'], points: 2 },
    { question: 'What does DPC stand for in construction?', type: 'mcq', options: ['Double Plaster Coating', 'Damp Proof Course', 'Dense Portland Cement', 'Dry Plumb Check'], correctOption: 1, points: 1 },
    { question: 'Standard brick size in Pakistan is approximately 9" × 4.5" × _____.', type: 'fill-blank', acceptableAnswers: ['3"', '3 inches', '3', '3 inch'], points: 1 },
  ],
  welder: [
    { question: 'Which welding process uses a consumable electrode coated in flux?', type: 'mcq', options: ['TIG', 'MIG', 'SMAW (stick welding)', 'Oxy-fuel'], correctOption: 2, points: 1 },
    { question: 'Preheating metal before welding helps reduce the risk of cracking.', type: 'true-false', correctAnswer: 'true', points: 1 },
    { question: 'The minimum shade number for arc welding helmets is typically _____.', type: 'fill-blank', acceptableAnswers: ['10', '11', '12', 'shade 10'], points: 1 },
    { question: 'Explain what an undercut defect is and how to prevent it.', type: 'short-answer', acceptableAnswers: ['groove melted base metal not filled', 'groove along weld toe reduce speed', 'unfilled groove lower current slower travel'], points: 2 },
    { question: 'What gas is commonly used as shielding gas in MIG welding of mild steel?', type: 'mcq', options: ['Oxygen', 'CO2 or Argon/CO2 mix', 'Nitrogen', 'Hydrogen'], correctOption: 1, points: 1 },
    { question: 'Welding in a confined space requires no special precautions beyond normal PPE.', type: 'true-false', correctAnswer: 'false', points: 1 },
    { question: 'A weld that joins two pieces at a right angle is called a _____ weld.', type: 'fill-blank', acceptableAnswers: ['fillet', 'Fillet'], points: 1 },
    { question: 'What is the purpose of a welding procedure specification (WPS)?', type: 'short-answer', acceptableAnswers: ['standardize welding parameters quality', 'defines how to perform weld', 'document procedures ensure consistency'], points: 2 },
    { question: 'Which defect appears as small holes in the weld bead?', type: 'mcq', options: ['Undercut', 'Porosity', 'Slag inclusion', 'Overlap'], correctOption: 1, points: 1 },
    { question: 'The process of examining welds without destroying them is called _____ testing (NDT).', type: 'fill-blank', acceptableAnswers: ['non-destructive', 'nondestructive', 'Non-destructive', 'non destructive'], points: 1 },
  ],
  plumber: [
    { question: 'What is the standard slope for drainage pipes per foot/meter?', type: 'mcq', options: ['1/8 inch per foot', '1/4 inch per foot', '1/2 inch per foot', '1 inch per foot'], correctOption: 1, points: 1 },
    { question: 'A P-trap prevents sewer gases from entering a building.', type: 'true-false', correctAnswer: 'true', points: 1 },
    { question: 'The pipe material commonly used for potable water supply is _____ (CPVC or copper).', type: 'fill-blank', acceptableAnswers: ['CPVC', 'copper', 'PPR', 'PEX'], points: 1 },
    { question: 'Explain the purpose of a vent pipe in a plumbing system.', type: 'short-answer', acceptableAnswers: ['allows air flow prevents siphoning traps', 'equalizes pressure prevents trap seal loss', 'air supply drainage proper flow'], points: 2 },
    { question: 'Which tool is used to join copper pipes permanently?', type: 'mcq', options: ['Pipe wrench', 'Soldering torch', 'Hacksaw', 'Thread cutter'], correctOption: 1, points: 1 },
    { question: 'Hot water pipes should always be insulated in cold climates.', type: 'true-false', correctAnswer: 'true', points: 1 },
    { question: 'The fitting that changes pipe direction by 90 degrees is called an _____.', type: 'fill-blank', acceptableAnswers: ['elbow', 'Elbow', '90 degree elbow', 'ell'], points: 1 },
    { question: 'What is a backflow preventer and why is it important?', type: 'short-answer', acceptableAnswers: ['prevents contaminated water flowing back', 'stops reverse flow protect supply', 'device prevents backflow contamination'], points: 2 },
    { question: 'What type of pipe joint allows for expansion and contraction?', type: 'mcq', options: ['Threaded joint', 'Expansion joint', 'Flanged joint', 'Compression joint'], correctOption: 1, points: 1 },
    { question: 'The device that controls water pressure in a building is called a pressure _____ valve.', type: 'fill-blank', acceptableAnswers: ['reducing', 'regulating', 'Reducing', 'Regulating'], points: 1 },
  ],
  carpenter: [
    { question: 'Which type of joint is strongest for connecting two pieces of wood at 90 degrees?', type: 'mcq', options: ['Butt joint', 'Mortise and tenon', 'Lap joint', 'Mitre joint'], correctOption: 1, points: 1 },
    { question: 'Plywood is stronger than solid wood of the same thickness because of cross-grain construction.', type: 'true-false', correctAnswer: 'true', points: 1 },
    { question: 'The tool used to smooth wood surfaces by shaving thin layers is called a _____.', type: 'fill-blank', acceptableAnswers: ['plane', 'Plane', 'hand plane', 'jack plane'], points: 1 },
    { question: 'Explain what seasoning of timber means and why it is important.', type: 'short-answer', acceptableAnswers: ['drying wood reduce moisture prevents warping', 'removing moisture content stability', 'drying timber prevent shrinkage cracking'], points: 2 },
    { question: 'What is the moisture content percentage recommended for indoor timber?', type: 'mcq', options: ['5-8%', '8-12%', '15-20%', '20-25%'], correctOption: 1, points: 1 },
    { question: 'Softwood trees are always softer than hardwood trees.', type: 'true-false', correctAnswer: 'false', points: 1 },
    { question: 'The defect in timber caused by fungal growth is called _____.', type: 'fill-blank', acceptableAnswers: ['rot', 'decay', 'wood rot', 'dry rot', 'wet rot'], points: 1 },
    { question: 'What is the purpose of a chamfer on a piece of wood?', type: 'short-answer', acceptableAnswers: ['beveled edge decorative safety', 'angled edge removes sharp corner', '45 degree cut edge protection'], points: 2 },
    { question: 'Which adhesive is waterproof and suitable for outdoor woodwork?', type: 'mcq', options: ['PVA glue', 'Epoxy resin', 'Hot melt glue', 'Contact cement'], correctOption: 1, points: 1 },
    { question: 'Standard plywood sheet size is _____ feet × 4 feet.', type: 'fill-blank', acceptableAnswers: ['8', '8 feet', 'eight'], points: 1 },
  ],
};

// ═══════════════════════════════════════════════════════════════
// GAP #1: RPL Readiness Guide Templates (per trade)
// ═══════════════════════════════════════════════════════════════
const RPL_READINESS_GUIDES = {
  default: {
    version: '1.0',
    title: 'RPL Assessment Readiness Guide',
    sections: [
      { id: 'overview', title: 'What is RPL?', content: 'Recognition of Prior Learning (RPL) is a process that assesses your existing skills and knowledge gained through work experience, informal training, and life experience. It compares your competencies against national qualification standards to award formal credentials without requiring you to repeat training you have already mastered.' },
      { id: 'eligibility', title: 'Am I Eligible?', content: 'You are eligible for RPL if you have: (1) At least 2 years of relevant work experience in your trade, (2) Evidence of skills through work samples, references, or certificates, (3) Current or recent employment in the trade area. The pre-screening self-assessment will confirm your eligibility and recommended NQF level.' },
      { id: 'process', title: 'The RPL Process', content: 'RPL assessment follows 6 stages: (1) Pre-Screening Self-Assessment — rate your skills and experience, (2) Evidence Submission — upload documents proving your competencies, (3) Document Review — assessor verifies your evidence, (4) Knowledge Test — written exam on trade theory, (5) Structured Interview — in-depth competency discussion, (6) Practical Demonstration — hands-on skills test. Each stage must be completed before the next.' },
      { id: 'evidence', title: 'Evidence Requirements', content: 'You will need to prepare: Experience letters from employers, Trade certificates or training records, Reference letters from supervisors, Work sample photos or videos, Identity documents (CNIC). Use the trade-specific evidence checklist to ensure you have everything ready.' },
      { id: 'timeline', title: 'Expected Timeline', content: 'A typical RPL assessment takes 2-4 weeks: Pre-screening (1 day), Evidence gathering (1 week), Document review (3 days), Knowledge test (1 day), Interview (1 day), Practical demo (1 day). The actual timeline depends on your evidence readiness and assessor availability.' },
      { id: 'tips', title: 'Tips for Success', content: 'Prepare thoroughly: (1) Gather all documents before starting, (2) Practice describing your work experience clearly, (3) Review trade theory and safety standards, (4) Prepare for the practical demonstration, (5) Be honest in your self-assessment — partial recognition is better than failure, (6) Ask your assessor if you have questions about any stage.' },
      { id: 'faq', title: 'Frequently Asked Questions', content: 'Q: What if I fail? A: You can receive partial recognition for competencies you demonstrate, and gap training for areas needing improvement. Q: How long is the credential valid? A: RPL credentials are typically valid for 3-5 years. Q: Can I appeal? A: Yes, you have 14 days to appeal any decision. Q: What if I don\'t have formal certificates? A: Work experience letters and practical demonstrations can substitute for formal certificates.' },
    ],
  },
  electrician: {
    version: '1.0',
    title: 'RPL Readiness Guide — Electrician',
    sections: [
      { id: 'overview', title: 'RPL for Electricians', content: 'This RPL assessment evaluates your competencies in electrical installation, maintenance, and safety. It covers residential, commercial, and industrial electrical systems according to Pakistani Wiring Rules and IEC standards.' },
      { id: 'eligibility', title: 'Eligibility for Electricians', content: 'Minimum requirements: (1) 3+ years experience in electrical installations, (2) Knowledge of single and three-phase systems, (3) Familiarity with circuit protection devices, (4) Understanding of earthing and bonding requirements, (5) Experience with distribution boards and wiring systems.' },
      { id: 'process', title: 'Assessment Process', content: 'You will be assessed on 8 core competency areas: Wiring Installation, Circuit Design, Safety & Grounding, Panel Installation, Testing & Measurement, Code Compliance, Troubleshooting, and Motor Controls. The practical demo requires wiring a distribution board and performing insulation resistance tests.' },
      { id: 'evidence', title: 'Required Evidence', content: 'Essential documents: (1) Employer letters confirming electrical work, (2) Any electrical trade certificates or TEVTA diplomas, (3) Safety training certificates, (4) Photos of completed installations, (5) Reference from a licensed electrician or supervisor.' },
      { id: 'knowledge', title: 'Knowledge Test Topics', content: 'The written test covers: Ohm\'s law and basic circuit theory, Wire sizing and color codes, Circuit protection (MCBs, RCDs, fuses), Earthing systems (TN-S, TN-C-S, TT), Testing procedures (insulation resistance, earth continuity), Electrical safety regulations.' },
      { id: 'tips', title: 'Preparation Tips', content: 'Review: (1) Pakistani Wiring Rules and IEC 60364, (2) Cable sizing tables, (3) MCB/RCD selection criteria, (4) Testing procedures using a multifunction tester, (5) First aid for electric shock, (6) Lockout/tagout procedures.' },
      { id: 'faq', title: 'FAQ', content: 'Q: Do I need a license? A: RPL certification is separate from licensing but supports your application. Q: What NQF level can I achieve? A: Level 3-5 depending on your experience and test scores. Q: Can I bring my own tools? A: Yes, you may use your own tools for the practical demo.' },
    ],
  },
  mason: {
    version: '1.0',
    title: 'RPL Readiness Guide — Mason',
    sections: [
      { id: 'overview', title: 'RPL for Masons', content: 'This RPL assessment evaluates your competencies in masonry construction including bricklaying, block work, plastering, and concrete work according to building codes and construction standards.' },
      { id: 'eligibility', title: 'Eligibility for Masons', content: 'Minimum requirements: (1) 2+ years experience in masonry/bricklaying, (2) Knowledge of mortar mixing ratios, (3) Ability to read construction drawings, (4) Experience with leveling and alignment, (5) Knowledge of safety practices on construction sites.' },
      { id: 'process', title: 'Assessment Process', content: 'You will be assessed on: Foundation Laying, Brick & Block Bonding, Plastering, Leveling & Alignment, Mortar Mixing, Safety Compliance. The practical demo requires building a brick wall section with proper bonding and level.' },
      { id: 'evidence', title: 'Required Evidence', content: 'Essential documents: (1) Employer letters from construction companies, (2) Photos of completed masonry work, (3) Any TEVTA or vocational certificates, (4) Reference letters from site engineers or foremen, (5) Safety training records.' },
      { id: 'knowledge', title: 'Knowledge Test Topics', content: 'The written test covers: Mortar mix ratios and cement types, Brick bonding patterns (English, Flemish, stretcher), DPC (damp proof course) requirements, Curing procedures, Foundation types, and Building safety regulations.' },
      { id: 'tips', title: 'Preparation Tips', content: 'Practice: (1) Building a small wall to standard, (2) Mortar mixing without waste, (3) Using spirit level and plumb bob accurately, (4) Reading simple construction drawings, (5) Workplace safety procedures.' },
      { id: 'faq', title: 'FAQ', content: 'Q: What tools do I need? A: Trowel, spirit level, plumb bob, tape measure, string line. Q: How is the wall assessed? A: Level, plumb, alignment, mortar joints, and bonding pattern. Q: What NQF level? A: Level 2-4 based on complexity of work demonstrated.' },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════
// GAP #2: Evidence Preparation Checklist Templates (per trade)
// ═══════════════════════════════════════════════════════════════
const EVIDENCE_CHECKLIST_TEMPLATES = {
  default: [
    { itemId: 'id-cnic', title: 'CNIC / National ID Card', description: 'A clear copy of your valid Computerized National Identity Card', required: true },
    { itemId: 'id-photo', title: 'Passport-size Photographs', description: 'Two recent passport-size photographs with white background', required: true },
    { itemId: 'exp-letter-1', title: 'Experience Letter (Primary Employer)', description: 'Letter from your most recent/current employer confirming your role, duration, and responsibilities', required: true },
    { itemId: 'exp-letter-2', title: 'Experience Letter (Additional Employer)', description: 'Letter from a previous employer if you have worked for more than one company', required: false },
    { itemId: 'trade-cert', title: 'Trade Certificate / Diploma', description: 'Any formal vocational training certificate (TEVTA, PVTC, NAVTTC, or equivalent)', required: false },
    { itemId: 'ref-letter', title: 'Reference Letter', description: 'A character/competency reference from a supervisor, foreman, or senior tradesperson', required: true },
    { itemId: 'work-photos', title: 'Work Sample Photographs', description: 'At least 3 photographs showing your completed work (clearly visible quality)', required: true },
    { itemId: 'safety-cert', title: 'Safety Training Certificate', description: 'Certificate from any occupational health and safety training course', required: false },
    { itemId: 'education', title: 'Education Certificate', description: 'Highest education qualification (matric, middle, primary)', required: false },
    { itemId: 'skill-log', title: 'Skills / Work Log', description: 'A simple log listing major projects or tasks you have completed with dates and descriptions', required: false },
  ],
  electrician: [
    { itemId: 'id-cnic', title: 'CNIC / National ID Card', description: 'Valid CNIC copy', required: true },
    { itemId: 'id-photo', title: 'Passport-size Photographs (2)', description: 'Recent photos with white background', required: true },
    { itemId: 'exp-letter', title: 'Electrical Work Experience Letter', description: 'Letter from employer confirming electrical installation/maintenance work with duration and scope', required: true },
    { itemId: 'trade-cert', title: 'Electrical Trade Certificate', description: 'TEVTA/PVTC/NAVTTC diploma or certificate in electrical technology', required: false },
    { itemId: 'safety-cert', title: 'Electrical Safety Training Certificate', description: 'Certificate from electrical safety, first aid, or OSHA training', required: true },
    { itemId: 'ref-letter', title: 'Supervisor Reference Letter', description: 'Reference from a licensed electrician, engineer, or site supervisor', required: true },
    { itemId: 'wiring-photos', title: 'Wiring Installation Photos', description: 'Photos of distribution boards, cable routing, or panel installations you completed', required: true },
    { itemId: 'test-results', title: 'Testing/Commissioning Records', description: 'Any records of electrical testing (insulation resistance, earth continuity) you have performed', required: false },
    { itemId: 'license', title: 'Electrical License (if any)', description: 'Any provincial or city electrical work license or permit', required: false },
    { itemId: 'project-list', title: 'Project/Job List', description: 'List of major electrical projects completed with dates, scope, and client names', required: true },
  ],
  mason: [
    { itemId: 'id-cnic', title: 'CNIC / National ID Card', description: 'Valid CNIC copy', required: true },
    { itemId: 'id-photo', title: 'Passport-size Photographs (2)', description: 'Recent photos with white background', required: true },
    { itemId: 'exp-letter', title: 'Masonry Work Experience Letter', description: 'Letter from construction company confirming masonry work with project types and duration', required: true },
    { itemId: 'trade-cert', title: 'Masonry/Construction Certificate', description: 'TEVTA/PVTC diploma in masonry or construction technology', required: false },
    { itemId: 'safety-cert', title: 'Construction Safety Certificate', description: 'Certificate from site safety, scaffold safety, or similar training', required: false },
    { itemId: 'ref-letter', title: 'Foreman/Engineer Reference', description: 'Reference letter from a site foreman, civil engineer, or project manager', required: true },
    { itemId: 'work-photos', title: 'Completed Masonry Work Photos', description: 'Photos showing walls, plastering, foundations, or other masonry work you completed', required: true },
    { itemId: 'drawing-ability', title: 'Drawing Reading Evidence', description: 'Any evidence of your ability to read construction drawings (marked-up plans, site sketches)', required: false },
    { itemId: 'project-list', title: 'Construction Project List', description: 'List of construction projects with type (residential/commercial), location, and your role', required: true },
    { itemId: 'education', title: 'Education Certificate', description: 'Highest education qualification', required: false },
  ],
  welder: [
    { itemId: 'id-cnic', title: 'CNIC / National ID Card', description: 'Valid CNIC copy', required: true },
    { itemId: 'id-photo', title: 'Passport-size Photographs (2)', description: 'Recent photos with white background', required: true },
    { itemId: 'exp-letter', title: 'Welding Experience Letter', description: 'Letter confirming welding work experience including processes used (SMAW, MIG, TIG)', required: true },
    { itemId: 'trade-cert', title: 'Welding Certificate', description: 'TEVTA/NAVTTC welding diploma or any AWS/ASME certification', required: false },
    { itemId: 'safety-cert', title: 'Welding Safety Certificate', description: 'Certificate from welding safety, fire safety, or hot work permit training', required: true },
    { itemId: 'ref-letter', title: 'Welding Supervisor Reference', description: 'Reference from a certified welder, welding inspector, or workshop manager', required: true },
    { itemId: 'weld-photos', title: 'Weld Sample Photographs', description: 'Clear photos of your welds showing joint quality (butt, fillet, pipe welds)', required: true },
    { itemId: 'wps-records', title: 'WPS/Testing Records', description: 'Any welding procedure specifications or NDT test results from your work', required: false },
    { itemId: 'project-list', title: 'Welding Project List', description: 'List of welding projects with materials, processes, and positions used', required: true },
    { itemId: 'qualification', title: 'Welder Qualification Test Records', description: 'Any previous qualification test records (6G, 3G, etc.)', required: false },
  ],
};

// ═══════════════════════════════════════════════════════════════
// GAP #7: Three-Tier Credentialing Logic
// ═══════════════════════════════════════════════════════════════
function determineCredentialTier(assessment) {
  const stages = assessment.rpl?.stageCompleted || {};
  const exam = assessment.rpl?.challengeExam;
  const demo = assessment.rpl?.practicalDemo;

  // Certified-Plus: All stages passed + external moderation endorsed
  if (stages.challengeExam && stages.practicalDemo && stages.finalDecision &&
      exam?.passed && demo?.overallResult === 'pass' &&
      assessment.rpl?.externalModeration?.status === 'completed' &&
      assessment.rpl?.externalModeration?.decision === 'endorsed') {
    return 'certified-plus';
  }
  // Performance: Practical demo passed (regardless of exam)
  if (stages.practicalDemo && demo?.overallResult === 'pass') {
    return 'performance';
  }
  // Knowledge: Only challenge exam passed
  if (stages.challengeExam && exam?.passed) {
    return 'knowledge';
  }
  return null;
}

// List assessments
router.get('/', authenticate, [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('type').optional().isIn(VALID_TYPES),
  query('status').optional().isIn(VALID_STATUSES),
  query('worker').optional().isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { page = 1, limit = 20, type, status, assessor, worker } = req.query;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    if (worker) filter.worker = worker;
    if (req.user.role === 'assessor') filter.assessor = req.user._id;
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      // Guard: a worker with no profile must see nothing, not everything.
      // (filter.worker = undefined would be stripped by Mongoose → returns all.)
      filter.worker = ownWorker ? ownWorker._id : null;
    }

    const total = await Assessment.countDocuments(filter);
    const assessments = await Assessment.find(filter)
      .sort('-createdAt')
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .populate('worker', 'fullName trade registrationId district')
      .populate('assessor', 'name');

    res.json({
      assessments,
      pagination: { total, page: Number(page), pages: Math.ceil(total / limit) },
    });
  } catch (err) { next(err); }
});

// Gap 8: External moderation queue (MUST be before /:id to avoid param catch)
router.get('/external-moderation-queue', authenticate, authorize('admin', 'institution'), async (req, res, next) => {
  try {
    const assessments = await Assessment.find({
      status: 'awaiting-external-moderation',
      'rpl.externalModeration.status': 'pending',
    })
      .sort('-updatedAt')
      .populate('worker', 'fullName trade registrationId district')
      .populate('assessor', 'name')
      .populate('rpl.moderation.moderator', 'name');

    res.json(assessments);
  } catch (err) { next(err); }
});

// Gap 8: Moderation analytics (MUST be before /:id to avoid param catch)
router.get('/moderation-analytics', authenticate, authorize('admin', 'institution'), async (req, res, next) => {
  try {
    const assessments = await Assessment.find({
      type: 'rpl',
      completedAt: { $exists: true },
    }).populate('assessor', 'name').lean();

    const assessorMetrics = {};
    for (const a of assessments) {
      const assessorId = a.assessor?._id?.toString();
      if (!assessorId) continue;

      if (!assessorMetrics[assessorId]) {
        assessorMetrics[assessorId] = {
          assessorName: a.assessor.name,
          totalAssessed: 0,
          approved: 0,
          rejected: 0,
          externalModerated: 0,
          externalAgreed: 0,
          avgQualityScore: 0,
          qualityScores: [],
          flagged: false,
        };
      }
      const m = assessorMetrics[assessorId];
      m.totalAssessed += 1;
      if (a.status === 'approved') m.approved += 1;
      if (a.status === 'rejected') m.rejected += 1;

      if (a.rpl?.externalModeration?.status === 'completed') {
        m.externalModerated += 1;
        if (a.rpl.externalModeration.decision === 'endorsed') m.externalAgreed += 1;
        if (a.rpl.externalModeration.qualityScore) m.qualityScores.push(a.rpl.externalModeration.qualityScore);
        if (a.rpl.externalModeration.assessorConsistencyFlag) m.flagged = true;
      }
    }

    const metrics = Object.values(assessorMetrics).map(m => ({
      ...m,
      passRate: m.totalAssessed > 0 ? Math.round(m.approved / m.totalAssessed * 100) : 0,
      externalAgreementRate: m.externalModerated > 0 ? Math.round(m.externalAgreed / m.externalModerated * 100) : 0,
      avgQualityScore: m.qualityScores.length > 0
        ? Math.round(m.qualityScores.reduce((s, v) => s + v, 0) / m.qualityScores.length * 10) / 10
        : 0,
      qualityScores: undefined,
    }));

    res.json({ assessors: metrics });
  } catch (err) { next(err); }
});

// ====================================================================
// Phase 5 static routes — MUST be defined before /:id to avoid Express
// matching path segments like 'portfolio-templates' as a Mongo ID.
// The data constants and /:id sub-routes are defined further below.
// ====================================================================

// GET /portfolio-templates — List available portfolio templates
router.get('/portfolio-templates', authenticate, async (req, res, next) => {
  try {
    // PORTFOLIO_TEMPLATES is defined further below; this works because
    // the route handler is only called at request-time, not at definition-time.
    const trade = req.query.trade;
    if (trade && PORTFOLIO_TEMPLATES[trade]) {
      return res.json({ template: PORTFOLIO_TEMPLATES[trade] });
    }
    const templates = Object.entries(PORTFOLIO_TEMPLATES)
      .filter(([key]) => key !== 'default')
      .map(([key, tpl]) => ({ trade: key, templateId: tpl.templateId, title: tpl.title, sections: tpl.sections.length }));
    res.json({ total: templates.length, templates, defaultAvailable: true });
  } catch (err) { next(err); }
});

// GET /scenarios — List available scenario-based assessments
router.get('/scenarios', authenticate, [
  query('trade').optional().trim(),
  handleValidation,
], async (req, res, next) => {
  try {
    const trade = req.query.trade;
    if (trade && SCENARIO_BANK[trade]) {
      return res.json({
        trade,
        total: SCENARIO_BANK[trade].length,
        scenarios: SCENARIO_BANK[trade].map(s => ({
          scenarioId: s.scenarioId, title: s.title, description: s.description, difficulty: s.difficulty, steps: s.steps.length,
        })),
      });
    }
    const all = Object.entries(SCENARIO_BANK).map(([t, scenarios]) => ({
      trade: t, count: scenarios.length,
      scenarios: scenarios.map(s => ({ scenarioId: s.scenarioId, title: s.title, difficulty: s.difficulty })),
    }));
    res.json({ trades: all.length, scenarios: all });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #32: Fee Schedule Templates (static route before /:id)
// ====================================================================
const FEE_SCHEDULES = {
  'STANDARD-2026': {
    id: 'STANDARD-2026',
    name: 'Standard RPL Fee Schedule 2026',
    currency: 'PKR',
    items: [
      { feeType: 'registration', amount: 500, description: 'RPL application registration fee' },
      { feeType: 'assessment', amount: 2500, description: 'Full RPL assessment fee (interview + practical demo)' },
      { feeType: 'credential-issuance', amount: 1000, description: 'Credential printing and issuance' },
      { feeType: 'appeal', amount: 1500, description: 'Appeal processing fee (refundable if upheld)' },
      { feeType: 'reassessment', amount: 2000, description: 'Re-assessment fee for previously assessed candidates' },
      { feeType: 'challenge-exam', amount: 800, description: 'Written knowledge challenge exam fee' },
      { feeType: 'workplace-observation', amount: 1200, description: 'On-site workplace observation fee' },
    ],
  },
  'SUBSIDIZED-2026': {
    id: 'SUBSIDIZED-2026',
    name: 'Subsidized RPL Fee Schedule 2026 (NAVTTC/Donor Funded)',
    currency: 'PKR',
    items: [
      { feeType: 'registration', amount: 0, description: 'Registration fee waived under subsidy' },
      { feeType: 'assessment', amount: 500, description: 'Subsidized assessment fee' },
      { feeType: 'credential-issuance', amount: 200, description: 'Subsidized credential issuance' },
      { feeType: 'appeal', amount: 500, description: 'Subsidized appeal fee' },
      { feeType: 'reassessment', amount: 800, description: 'Subsidized re-assessment fee' },
      { feeType: 'challenge-exam', amount: 200, description: 'Subsidized challenge exam fee' },
      { feeType: 'workplace-observation', amount: 300, description: 'Subsidized workplace observation fee' },
    ],
  },
};

// GET /fee-schedules — List available fee schedule templates
router.get('/fee-schedules', authenticate, async (req, res, next) => {
  try {
    const scheduleId = req.query.scheduleId;
    if (scheduleId && FEE_SCHEDULES[scheduleId]) {
      return res.json(FEE_SCHEDULES[scheduleId]);
    }
    const schedules = Object.values(FEE_SCHEDULES).map(s => ({
      id: s.id, name: s.name, currency: s.currency, itemCount: s.items.length,
      totalAmount: s.items.reduce((sum, i) => sum + i.amount, 0),
    }));
    res.json({ total: schedules.length, schedules });
  } catch (err) { next(err); }
});

// GET /assessor-dashboard/:assessorId — Assessor performance dashboard
router.get('/assessor-dashboard/:assessorId', authenticate, authorize('admin', 'institution', 'assessor'), [
  param('assessorId').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessorId = req.params.assessorId;
    if (req.user.role === 'worker') return res.status(403).json({ error: 'Access denied' });
    if (req.user.role === 'assessor' && req.user._id.toString() !== assessorId) {
      return res.status(403).json({ error: 'Can only view your own dashboard' });
    }

    const user = await User.findById(assessorId).select(
      'name email assessorQualifications cpdRecords cpdYearStart cpdRequiredHours assessorExperience'
    );
    if (!user) return res.status(404).json({ error: 'Assessor not found' });

    const allAssessments = await Assessment.find({ assessor: assessorId }).select(
      'status type trade score rpl.interview rpl.practicalDemo rpl.moderation rpl.externalModeration rpl.interRaterCheck createdAt completedAt'
    );

    const totalAssessments = allAssessments.length;
    const completed = allAssessments.filter(a => ['approved', 'rejected'].includes(a.status)).length;
    const approved = allAssessments.filter(a => a.status === 'approved').length;
    const rejected = allAssessments.filter(a => a.status === 'rejected').length;
    const pending = allAssessments.filter(a => ['pending', 'in-review'].includes(a.status)).length;
    const approvalRate = completed > 0 ? Math.round((approved / completed) * 100) : 0;
    const scoredAssessments = allAssessments.filter(a => a.score > 0);
    const avgScore = scoredAssessments.length > 0
      ? Math.round(scoredAssessments.reduce((s, a) => s + a.score, 0) / scoredAssessments.length)
      : 0;
    const byTrade = {};
    for (const a of allAssessments) { byTrade[a.trade] = (byTrade[a.trade] || 0) + 1; }
    const moderated = allAssessments.filter(a => a.rpl?.moderation?.decision);
    const endorsed = moderated.filter(a => a.rpl.moderation.decision === 'endorsed').length;
    const overturned = moderated.filter(a => a.rpl.moderation.decision === 'overturned').length;
    const referredBack = moderated.filter(a => a.rpl.moderation.decision === 'referred-back').length;
    const extModerated = allAssessments.filter(a => a.rpl?.externalModeration?.decision);
    const extEndorsed = extModerated.filter(a => a.rpl.externalModeration.decision === 'endorsed').length;
    const irChecks = allAssessments.filter(a => a.rpl?.interRaterCheck?.status === 'completed');
    const irScores = irChecks.map(a => a.rpl.interRaterCheck.agreement?.reliabilityScore).filter(Boolean);
    const avgReliability = irScores.length > 0
      ? Math.round(irScores.reduce((s, r) => s + r, 0) / irScores.length)
      : null;
    const completedWithDates = allAssessments.filter(a => a.completedAt && a.createdAt);
    const avgTurnaround = completedWithDates.length > 0
      ? Math.round(completedWithDates.reduce((s, a) => s + ((new Date(a.completedAt) - new Date(a.createdAt)) / 86400000), 0) / completedWithDates.length * 10) / 10
      : null;
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const monthly = {};
    for (const a of allAssessments) {
      if (new Date(a.createdAt) >= sixMonthsAgo) {
        const key = new Date(a.createdAt).toISOString().slice(0, 7);
        monthly[key] = (monthly[key] || 0) + 1;
      }
    }
    const now = new Date();
    const yearStart = user.cpdYearStart || new Date(now.getFullYear(), 0, 1);
    const cpdHours = (user.cpdRecords || [])
      .filter(r => new Date(r.completedDate) >= yearStart)
      .reduce((sum, r) => sum + r.hours, 0);

    res.json({
      assessor: { _id: user._id, name: user.name, email: user.email },
      summary: { totalAssessments, completed, approved, rejected, pending, approvalRate, avgScore, avgTurnaround },
      byTrade,
      moderation: { total: moderated.length, endorsed, overturned, referredBack, endorsementRate: moderated.length > 0 ? Math.round((endorsed / moderated.length) * 100) : 0 },
      externalModeration: { total: extModerated.length, endorsed: extEndorsed },
      interRaterReliability: { checksCompleted: irChecks.length, avgReliabilityScore: avgReliability },
      cpd: { hoursThisYear: cpdHours, requiredHours: user.cpdRequiredHours || 20, compliant: cpdHours >= (user.cpdRequiredHours || 20) },
      qualifications: (user.assessorQualifications || []).length,
      monthlyActivity: monthly,
      experience: user.assessorExperience || {},
    });
  } catch (err) { next(err); }
});

// POST /apply — Worker self-service RPL application
router.post('/apply', authenticate, authorize('worker'), [
  body('trade').trim().notEmpty().withMessage('Trade is required'),
  body('nqfLevel').optional().isInt({ min: 1, max: 8 }).withMessage('NQF level must be 1-8'),
  body('yearsExperience').optional().isInt({ min: 0, max: 50 }).withMessage('Years of experience must be 0-50'),
  body('motivation').optional().trim().isLength({ max: 1000 }).withMessage('Motivation must be under 1000 characters'),
  body('employerCountries').optional().isArray(),
  body('previousCertifications').optional().trim().isLength({ max: 500 }),
  handleValidation,
], auditLog('RPL_SELF_APPLICATION'), async (req, res, next) => {
  try {
    const workerDoc = await Worker.findOne({ user: req.user._id });
    if (!workerDoc) return res.status(404).json({ error: 'Worker profile not found. Please complete your profile first.' });

    const { trade, nqfLevel, yearsExperience, motivation, employerCountries, previousCertifications } = req.body;

    // Prevent duplicate active applications for same trade
    const existing = await Assessment.findOne({
      worker: workerDoc._id,
      type: 'rpl',
      trade,
      status: { $nin: ['approved', 'rejected'] },
    });
    if (existing) {
      return res.status(409).json({ error: `You already have an active RPL application for ${trade}. Please wait for it to be processed.` });
    }

    // Pre-populate RPL templates
    const interviewTemplate = INTERVIEW_TEMPLATES[trade] || INTERVIEW_TEMPLATES.default;
    const rubricTemplate = DEMO_RUBRIC_TEMPLATES[trade] || DEMO_RUBRIC_TEMPLATES.default;
    const preScreeningTemplate = PRE_SCREENING_TEMPLATES[trade] || PRE_SCREENING_TEMPLATES.default;

    const assessment = await Assessment.create({
      worker: workerDoc._id,
      type: 'rpl',
      trade,
      title: `RPL Application — ${workerDoc.fullName}`,
      status: 'pending',
      rpl: {
        selfApplication: {
          applied: true,
          appliedAt: new Date(),
          nqfLevel: nqfLevel || workerDoc.nqfLevel || 1,
          yearsExperience: yearsExperience ?? workerDoc.experience?.years ?? 0,
          motivation: motivation || '',
          employerCountries: employerCountries || workerDoc.experience?.countries || [],
          previousCertifications: previousCertifications || '',
        },
        preScreening: {
          completed: false,
          responses: preScreeningTemplate.map(t => ({ area: t.area, question: t.question, hasEvidence: false })),
        },
        interview: { items: interviewTemplate.map(t => ({ ...t, response: '', score: 0 })) },
        practicalDemo: { rubric: rubricTemplate.map(r => ({ ...r, score: 0, notes: '' })), overallResult: 'pending' },
        stageCompleted: {
          preScreening: false,
          evidenceSubmission: false, documentReview: false,
          interview: false, practicalDemo: false, finalDecision: false,
        },
      },
    });

    // Notify admins/institutions about the new self-application
    try {
      const admins = await User.find({ role: { $in: ['admin', 'institution'] }, active: { $ne: false } }).select('_id').lean();
      for (const admin of admins) {
        await createRPLNotification({
          recipientUserId: admin._id,
          stage: 'rpl-application-received',
          assessment,
          details: `New RPL self-application from ${workerDoc.fullName} for ${trade}`,
          worker: workerDoc,
        });
      }
    } catch { /* notification failure shouldn't block */ }

    res.status(201).json(assessment);
  } catch (err) { next(err); }
});

// Get single assessment
router.get('/:id', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .populate('worker', 'fullName trade registrationId district')
      .populate('assessor', 'name')
      .populate('rpl.moderation.moderator', 'name');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    // Ownership checks
    if (req.user.role === 'assessor' && assessment.assessor?._id?.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker?._id?.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    res.json(assessment);
  } catch (err) { next(err); }
});

// Create assessment
router.post('/', authenticate, authorize('admin', 'assessor', 'institution'), [
  body('worker').isMongoId().withMessage('Valid worker ID required'),
  body('type').isIn(VALID_TYPES).withMessage('Invalid assessment type'),
  body('trade').trim().notEmpty().withMessage('Trade is required'),
  body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 300 }),
  handleValidation,
], auditLog('ASSESSMENT_CREATE'), async (req, res, next) => {
  try {
    const { worker, type, trade, title } = req.body;

    const workerDoc = await Worker.findById(worker);
    if (!workerDoc) return res.status(404).json({ error: 'Worker not found' });

    const assessmentData = { worker, type, trade, title, assessor: req.user._id };

    // Issue #2 & #3 & Gap 7: Pre-populate interview template, rubric, and pre-screening for RPL assessments
    if (type === 'rpl') {
      const interviewTemplate = INTERVIEW_TEMPLATES[trade] || INTERVIEW_TEMPLATES.default;
      const rubricTemplate = DEMO_RUBRIC_TEMPLATES[trade] || DEMO_RUBRIC_TEMPLATES.default;
      const preScreeningTemplate = PRE_SCREENING_TEMPLATES[trade] || PRE_SCREENING_TEMPLATES.default;
      assessmentData.rpl = {
        preScreening: {
          completed: false,
          responses: preScreeningTemplate.map(t => ({ area: t.area, question: t.question, hasEvidence: false })),
        },
        interview: { items: interviewTemplate.map(t => ({ ...t, response: '', score: 0 })) },
        practicalDemo: { rubric: rubricTemplate.map(r => ({ ...r, score: 0, notes: '' })), overallResult: 'pending' },
        stageCompleted: {
          preScreening: false,
          evidenceSubmission: false, documentReview: false,
          interview: false, practicalDemo: false, finalDecision: false,
        },
      };
    }

    const assessment = await Assessment.create(assessmentData);
    res.status(201).json(assessment);
  } catch (err) { next(err); }
});

// Upload video for assessment
router.post('/:id/video', authenticate, authorize('admin', 'assessor', 'worker'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], upload.single('video'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    if (req.user.role === 'assessor' && assessment.assessor.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied: not your assessment' });
    }
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });

    if (!ALLOWED_MIME.video.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Only video files are allowed' });
    }

    assessment.video = {
      filename: req.file.filename,
      url: `/api/uploads/${req.file.filename}`,
      duration: req.body.duration || 0,
      taskName: req.body.taskName || assessment.title,
    };
    assessment.status = 'pending';
    await assessment.save();
    res.json(assessment);
  } catch (err) { next(err); }
});

// Gap 7: Submit pre-screening self-assessment
router.put('/:id/pre-screening', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('responses').isArray({ min: 1 }).withMessage('Responses required'),
  body('tradeExperience').isObject().withMessage('Trade experience required'),
  handleValidation,
], auditLog('ASSESSMENT_PRE_SCREENING'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    if (assessment.type !== 'rpl') {
      return res.status(400).json({ error: 'Pre-screening is only available for RPL assessments' });
    }

    // Ownership check for workers
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    const { responses, tradeExperience } = req.body;

    // Calculate eligibility score
    let totalWeightedScore = 0;
    let totalWeight = 0;
    const gapAreas = [];

    for (const resp of responses) {
      const rating = Math.min(Math.max(resp.selfRating || 0, 0), 5);
      const evidenceBonus = resp.hasEvidence ? 1.5 : 1;
      const experienceBonus = (resp.yearsExperience || 0) >= 3 ? 1.3 : (resp.yearsExperience || 0) >= 1 ? 1.1 : 1;
      const weighted = rating * evidenceBonus * experienceBonus;
      totalWeightedScore += weighted;
      totalWeight += 5 * 1.5 * 1.3; // max possible

      if (rating < 3) {
        gapAreas.push(resp.area);
      }
    }

    const eligibilityScore = totalWeight > 0 ? Math.round((totalWeightedScore / totalWeight) * 100) : 0;

    // Determine recommendation
    let recommendation, eligible;
    if (eligibilityScore >= 60) {
      recommendation = 'proceed';
      eligible = true;
    } else if (eligibilityScore >= 40) {
      recommendation = 'partial';
      eligible = true;
    } else {
      recommendation = 'not-ready';
      eligible = false;
    }

    // Determine recommended NQF level based on experience and ratings
    const avgRating = responses.reduce((s, r) => s + (r.selfRating || 0), 0) / (responses.length || 1);
    const years = tradeExperience.totalYears || 0;
    let recommendedLevel = 1;
    if (avgRating >= 4 && years >= 5) recommendedLevel = 5;
    else if (avgRating >= 3.5 && years >= 3) recommendedLevel = 4;
    else if (avgRating >= 3 && years >= 2) recommendedLevel = 3;
    else if (avgRating >= 2 && years >= 1) recommendedLevel = 2;

    // Update assessment
    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.preScreening = {
      completed: true,
      completedAt: new Date(),
      eligibilityScore,
      eligible,
      responses,
      tradeExperience,
      recommendation,
      recommendedLevel,
      gapAreas,
    };

    if (!assessment.rpl.stageCompleted) assessment.rpl.stageCompleted = {};
    assessment.rpl.stageCompleted.preScreening = true;

    // Gap #5: Auto-record timeline
    if (!assessment.rpl.timeline) assessment.rpl.timeline = [];
    assessment.rpl.timeline.push({ stage: 'pre-screening', startedAt: assessment.createdAt, completedAt: new Date(), actualDurationDays: Math.ceil((Date.now() - new Date(assessment.createdAt).getTime()) / 86400000) });

    await assessment.save();

    // Gap #22: Notify assessor of pre-screening completion
    createRPLNotification({ recipientUserId: assessment.assessor, stage: 'pre-screening', assessment, details: `Pre-screening score: ${eligibilityScore}%, Recommendation: ${recommendation}` }).catch(() => {});

    const populated = await Assessment.findById(assessment._id)
      .populate('worker', 'fullName trade registrationId district')
      .populate('assessor', 'name');

    res.json({
      eligibilityScore,
      eligible,
      recommendation,
      recommendedLevel,
      gapAreas,
      assessment: populated || assessment,
    });
  } catch (err) { next(err); }
});

// Issue #1: Upload RPL evidence documents with category
router.post('/:id/evidence', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], upload.array('documents', 10), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    // Ownership check
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    } else if (req.user.role === 'assessor' && assessment.assessor.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied: not your assessment' });
    }

    // Gap 7: Gate on pre-screening completion
    if (assessment.type === 'rpl' && !assessment.rpl?.preScreening?.completed) {
      return res.status(400).json({ error: 'Pre-screening self-assessment must be completed before submitting evidence.' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No documents uploaded' });
    }

    // Parse categories from body — expects comma-separated or JSON array
    let categories = [];
    if (req.body.categories) {
      try { categories = JSON.parse(req.body.categories); } catch { categories = String(req.body.categories).split(','); }
    }

    const docs = req.files.map((f, i) => ({
      filename: f.originalname,
      url: `/api/uploads/${f.filename}`,
      uploadedAt: new Date(),
      category: EVIDENCE_CATEGORIES.includes(categories[i]) ? categories[i] : 'other',
    }));

    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.documentaryEvidence = [...(assessment.rpl.documentaryEvidence || []), ...docs];

    // Issue #1: Update evidence sufficiency
    assessment.rpl.evidenceSufficiency = updateEvidenceSufficiency(assessment.rpl.documentaryEvidence);

    // Issue #4: Mark evidence stage complete if minimum requirements met
    const suf = assessment.rpl.evidenceSufficiency;
    if (assessment.rpl.documentaryEvidence.length >= 2 && (suf.hasExperienceLetter || suf.hasTradeCertificate)) {
      if (!assessment.rpl.stageCompleted) assessment.rpl.stageCompleted = {};
      assessment.rpl.stageCompleted.evidenceSubmission = true;
    }

    await assessment.save();

    // xAPI: RPL evidence submitted (fire-and-forget)
    emitRPLEvidenceSubmitted(assessment.worker, assessment._id, assessment.trade || 'RPL Assessment').catch(() => {});

    // Gap #22: Notify assessor of evidence submission
    createRPLNotification({ recipientUserId: assessment.assessor, stage: 'evidence-submission', assessment, details: `${docs.length} evidence document(s) uploaded.` }).catch(() => {});

    // Gap #5: Auto-record timeline
    if (assessment.rpl.stageCompleted?.evidenceSubmission) {
      if (!assessment.rpl.timeline) assessment.rpl.timeline = [];
      if (!assessment.rpl.timeline.find(t => t.stage === 'evidence-submission')) {
        assessment.rpl.timeline.push({ stage: 'evidence-submission', completedAt: new Date() });
        await assessment.save();
      }
    }

    const populated = await Assessment.findById(assessment._id)
      .populate('worker', 'fullName trade registrationId district')
      .populate('assessor', 'name');
    res.json(populated || assessment);
  } catch (err) { next(err); }
});

// Issue #4: Complete document review stage
router.put('/:id/document-review', authenticate, authorize('admin', 'assessor'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('feedback').optional().trim().isLength({ max: 2000 }),
  handleValidation,
], auditLog('ASSESSMENT_DOC_REVIEW'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    if (req.user.role === 'assessor' && assessment.assessor.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied: not your assessment' });
    }

    // Stage gate: evidence must be submitted first
    if (!assessment.rpl?.stageCompleted?.evidenceSubmission) {
      return res.status(400).json({ error: 'Stage gate: evidence must be submitted before document review. Minimum 2 documents including an experience letter or trade certificate required.' });
    }

    if (!assessment.rpl.stageCompleted) assessment.rpl.stageCompleted = {};
    assessment.rpl.stageCompleted.documentReview = true;
    assessment.status = 'in-review';
    if (req.body.feedback) assessment.feedback = req.body.feedback;

    // Gap #5: Timeline tracking
    if (!assessment.rpl.timeline) assessment.rpl.timeline = [];
    if (!assessment.rpl.timeline.find(t => t.stage === 'document-review')) {
      assessment.rpl.timeline.push({ stage: 'document-review', completedAt: new Date(), assignedTo: req.user._id });
    }

    await assessment.save();

    // Gap #22: Notify worker of document review completion
    const workerForNotif = await Worker.findById(assessment.worker).populate('user', 'email _id');
    if (workerForNotif?.user) {
      createRPLNotification({ recipientUserId: workerForNotif.user._id, stage: 'document-review', assessment, worker: workerForNotif }).catch(() => {});
    }

    const populated = await Assessment.findById(assessment._id)
      .populate('worker', 'fullName trade registrationId district')
      .populate('assessor', 'name');
    res.json(populated || assessment);
  } catch (err) { next(err); }
});

// Issue #2: Submit structured interview
router.put('/:id/interview', authenticate, authorize('admin', 'assessor'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('items').isArray({ min: 1 }).withMessage('Interview items required'),
  body('items.*.competencyArea').notEmpty().withMessage('Competency area required'),
  body('items.*.score').isInt({ min: 0, max: 4 }).withMessage('Score must be 0-4'),
  body('overallNotes').optional().trim().isLength({ max: 3000 }),
  body('durationMinutes').optional().isInt({ min: 1, max: 480 }).toInt(),
  handleValidation,
], auditLog('ASSESSMENT_INTERVIEW'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    if (req.user.role === 'assessor' && assessment.assessor.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied: not your assessment' });
    }

    // Issue #4: Stage gate — document review must be done
    if (!assessment.rpl?.stageCompleted?.documentReview) {
      return res.status(400).json({ error: 'Stage gate: document review must be completed before interview.' });
    }

    const { items, overallNotes, durationMinutes } = req.body;
    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.interview = {
      items,
      overallNotes: overallNotes || '',
      durationMinutes: durationMinutes || 0,
      conductedAt: new Date(),
    };
    // Also keep legacy field populated
    assessment.rpl.interviewNotes = overallNotes || items.map(i => `${i.competencyArea}: ${i.response || ''} (${i.score}/4)`).join('\n');

    if (!assessment.rpl.stageCompleted) assessment.rpl.stageCompleted = {};
    assessment.rpl.stageCompleted.interview = true;

    // Gap #5: Timeline tracking
    if (!assessment.rpl.timeline) assessment.rpl.timeline = [];
    if (!assessment.rpl.timeline.find(t => t.stage === 'interview')) {
      assessment.rpl.timeline.push({ stage: 'interview', completedAt: new Date(), assignedTo: req.user._id });
    }

    await assessment.save();

    // Gap #22: Notify worker of interview completion
    const workerForInterview = await Worker.findById(assessment.worker).populate('user', 'email _id');
    if (workerForInterview?.user) {
      createRPLNotification({ recipientUserId: workerForInterview.user._id, stage: 'interview', assessment, worker: workerForInterview }).catch(() => {});
    }

    const populated = await Assessment.findById(assessment._id)
      .populate('worker', 'fullName trade registrationId district')
      .populate('assessor', 'name');
    res.json(populated || assessment);
  } catch (err) { next(err); }
});

// Issue #3: Submit practical demonstration rubric
router.put('/:id/practical-demo', authenticate, authorize('admin', 'assessor'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('rubric').isArray({ min: 1 }).withMessage('Rubric items required'),
  body('rubric.*.criterion').notEmpty().withMessage('Criterion name required'),
  body('rubric.*.score').isInt({ min: 0, max: 4 }).withMessage('Score must be 0-4'),
  body('overallResult').isIn(['pass', 'fail']).withMessage('Result must be pass or fail'),
  body('location').optional().trim().isLength({ max: 300 }),
  handleValidation,
], auditLog('ASSESSMENT_PRACTICAL'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    if (req.user.role === 'assessor' && assessment.assessor.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied: not your assessment' });
    }

    // Issue #4: Stage gate — interview must be done
    if (!assessment.rpl?.stageCompleted?.interview) {
      return res.status(400).json({ error: 'Stage gate: interview must be completed before practical demonstration.' });
    }

    const { rubric, overallResult, location } = req.body;
    const maxScore = rubric.length * 4;
    const totalRaw = rubric.reduce((sum, r) => sum + (r.score || 0), 0);
    const totalScore = maxScore > 0 ? Math.round((totalRaw / maxScore) * 100) : 0;

    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.practicalDemo = {
      rubric,
      overallResult,
      totalScore,
      location: location || '',
      conductedAt: new Date(),
    };

    if (!assessment.rpl.stageCompleted) assessment.rpl.stageCompleted = {};
    assessment.rpl.stageCompleted.practicalDemo = true;

    // Gap #5: Timeline tracking
    if (!assessment.rpl.timeline) assessment.rpl.timeline = [];
    if (!assessment.rpl.timeline.find(t => t.stage === 'practical-demo')) {
      assessment.rpl.timeline.push({ stage: 'practical-demo', completedAt: new Date(), assignedTo: req.user._id });
    }

    await assessment.save();

    // Gap #22: Notify worker of practical demo completion
    const workerForDemo = await Worker.findById(assessment.worker).populate('user', 'email _id');
    if (workerForDemo?.user) {
      createRPLNotification({ recipientUserId: workerForDemo.user._id, stage: 'practical-demo', assessment, worker: workerForDemo, details: `Result: ${overallResult}, Score: ${totalScore}%` }).catch(() => {});
    }

    const populated = await Assessment.findById(assessment._id)
      .populate('worker', 'fullName trade registrationId district')
      .populate('assessor', 'name');
    res.json(populated || assessment);
  } catch (err) { next(err); }
});

// Submit checklist
router.put('/:id/checklist', authenticate, authorize('admin', 'assessor'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('items').isArray({ min: 1 }).withMessage('At least one checklist item required'),
  body('recommendation').isIn(['pass', 'remedial', 'fail']).withMessage('Invalid recommendation'),
  handleValidation,
], auditLog('ASSESSMENT_CHECKLIST'), async (req, res, next) => {
  try {
    if (req.user.role === 'assessor') {
      const existing = await Assessment.findById(req.params.id).select('assessor');
      if (existing && existing.assessor.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    const { items, site, recommendation, assessorNotes } = req.body;
    const assessment = await Assessment.findByIdAndUpdate(req.params.id, {
      checklist: { items, site, recommendation, assessorNotes },
      status: recommendation === 'pass' ? 'approved' : recommendation === 'fail' ? 'rejected' : 'needs-revision',
      score: items.length > 0 ? Math.round(items.filter(i => i.checked).length / items.length * 100) : 0,
      completedAt: new Date(),
    }, { new: true, runValidators: true });
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    // xAPI: checklist assessment completed (fire-and-forget)
    emitAssessmentCompleted(assessment.worker, assessment._id, assessment.trade || 'Checklist Assessment', assessment.score).catch(() => {});
    res.json(assessment);
  } catch (err) { next(err); }
});

// Submit simulation answers
router.put('/:id/simulation', authenticate, authorize('admin', 'assessor', 'worker'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('answers').isArray({ min: 1 }).withMessage('Answers are required'),
  body('timeTaken').optional().isInt({ min: 0 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const { answers, timeTaken } = req.body;
    const correct = answers.filter(a => a.isCorrect).length;
    const score = answers.length > 0 ? Math.round(correct / answers.length * 100) : 0;

    const assessment = await Assessment.findByIdAndUpdate(req.params.id, {
      simulation: { answers, totalQuestions: answers.length, correctAnswers: correct, timeTaken },
      score,
      status: score >= 70 ? 'approved' : 'rejected',
      completedAt: new Date(),
    }, { new: true, runValidators: true });
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    // xAPI: simulation assessment completed (fire-and-forget)
    emitAssessmentCompleted(assessment.worker, assessment._id, assessment.trade || 'Simulation Assessment', assessment.score).catch(() => {});
    res.json(assessment);
  } catch (err) { next(err); }
});

// Issue #7: Review assessment — now sends to moderation instead of direct approval
router.put('/:id/review', authenticate, authorize('admin', 'assessor'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('status').isIn(['approved', 'rejected', 'needs-revision']).withMessage('Invalid review status'),
  body('feedback').optional().trim().isLength({ max: 2000 }),
  body('score').optional().isFloat({ min: 0, max: 100 }),
  handleValidation,
], auditLog('ASSESSMENT_REVIEW'), async (req, res, next) => {
  try {
    if (req.user.role === 'assessor') {
      const existing = await Assessment.findById(req.params.id).select('assessor');
      if (existing && existing.assessor.toString() !== req.user._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    // Issue #4: Stage gate for RPL — all stages must be completed before final decision
    if (assessment.type === 'rpl' && req.body.status !== 'needs-revision') {
      const stages = assessment.rpl?.stageCompleted || {};
      if (!stages.evidenceSubmission || !stages.documentReview || !stages.interview || !stages.practicalDemo) {
        return res.status(400).json({
          error: 'Stage gate: all prior stages (evidence, document review, interview, practical demo) must be completed before final decision.',
          stageCompleted: stages,
        });
      }
    }

    const { status, feedback, score } = req.body;

    // Issue #7: For RPL approvals/rejections, route to moderation (awaiting-moderation)
    if (assessment.type === 'rpl' && ['approved', 'rejected'].includes(status)) {
      assessment.status = 'awaiting-moderation';
      assessment.feedback = feedback || '';
      if (score !== undefined) assessment.score = score;
      if (assessment.rpl) {
        if (!assessment.rpl.stageCompleted) assessment.rpl.stageCompleted = {};
        assessment.rpl.stageCompleted.finalDecision = true;
      }
      // Store assessor's intended decision for the moderator
      assessment.rpl.assessorDecision = status;

      // Gap #5: Timeline
      if (!assessment.rpl.timeline) assessment.rpl.timeline = [];
      if (!assessment.rpl.timeline.find(t => t.stage === 'final-decision')) {
        assessment.rpl.timeline.push({ stage: 'final-decision', completedAt: new Date(), assignedTo: req.user._id });
      }

      await assessment.save();

      // Gap #22: Notify worker that assessment is now in moderation
      const workerForMod = await Worker.findById(assessment.worker).populate('user', 'email _id');
      if (workerForMod?.user) {
        createRPLNotification({ recipientUserId: workerForMod.user._id, stage: 'moderation-complete', assessment, worker: workerForMod, details: 'Your assessment is now under moderation review.' }).catch(() => {});
      }

      return res.json(assessment);
    }

    // Non-RPL or needs-revision: apply directly
    assessment.status = status;
    if (feedback) assessment.feedback = feedback;
    if (score !== undefined) assessment.score = score;
    if (['approved', 'rejected'].includes(status)) assessment.completedAt = new Date();
    await assessment.save();

    // xAPI: assessment completed (fire-and-forget)
    if (['approved', 'rejected'].includes(status)) {
      emitAssessmentCompleted(assessment.worker, assessment._id, assessment.trade || 'Assessment', assessment.score).catch(() => {});
    }

    const populated = await Assessment.findById(assessment._id)
      .populate('worker', 'fullName trade');

    if (status === 'approved' && populated.worker) {
      await Worker.findByIdAndUpdate(populated.worker._id, { status: 'assessed' });
    }

    // Gap #22: Notify worker of decision
    if (['approved', 'rejected'].includes(status)) {
      const workerDecision = await Worker.findById(assessment.worker).populate('user', 'email _id');
      if (workerDecision?.user) {
        const stage = status === 'approved' ? 'decision-approved' : 'decision-rejected';
        createRPLNotification({ recipientUserId: workerDecision.user._id, stage, assessment, worker: workerDecision }).catch(() => {});
      }
    }

    // Issue #6 & #15: Generate gap training recommendations for needs-revision/rejected
    if (['needs-revision', 'rejected'].includes(status) && assessment.type === 'rpl') {
      await generateGapTraining(assessment);
    }

    res.json(populated || assessment);
  } catch (err) { next(err); }
});

// Issue #7: Moderation endpoint — second reviewer confirms/overturns
router.put('/:id/moderate', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('decision').isIn(['endorsed', 'overturned', 'referred-back']).withMessage('Invalid moderation decision'),
  body('comments').optional().trim().isLength({ max: 2000 }),
  handleValidation,
], auditLog('ASSESSMENT_MODERATE'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    if (assessment.status !== 'awaiting-moderation') {
      return res.status(400).json({ error: 'Assessment is not awaiting moderation' });
    }

    // Moderator cannot be the same person as the assessor
    if (assessment.assessor.toString() === req.user._id.toString()) {
      return res.status(403).json({ error: 'The assessor cannot moderate their own assessment. A different reviewer is required.' });
    }

    const { decision, comments } = req.body;

    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.moderation = {
      moderator: req.user._id,
      decision,
      comments: comments || '',
      moderatedAt: new Date(),
    };

    const assessorDecision = assessment.rpl.assessorDecision || 'approved';

    if (decision === 'endorsed') {
      // Apply the assessor's original decision
      assessment.status = assessorDecision;
      assessment.completedAt = new Date();
      if (assessorDecision === 'approved') {
        const worker = await Worker.findById(assessment.worker);
        if (worker) {
          worker.status = 'assessed';
          await worker.save();
        }
      }
      // Generate gap training for rejected
      if (assessorDecision === 'rejected' || assessorDecision === 'needs-revision') {
        await generateGapTraining(assessment);
      }
    } else if (decision === 'overturned') {
      // Reverse the decision
      assessment.status = assessorDecision === 'approved' ? 'rejected' : 'approved';
      assessment.completedAt = new Date();
      if (assessment.status === 'approved') {
        const worker = await Worker.findById(assessment.worker);
        if (worker) {
          worker.status = 'assessed';
          await worker.save();
        }
      }
      if (assessment.status === 'rejected') {
        await generateGapTraining(assessment);
      }
    } else if (decision === 'referred-back') {
      // Send back to assessor for re-evaluation
      assessment.status = 'needs-revision';
    }

    // Gap 8: After internal moderation, check if external moderation is required
    if (['endorsed', 'overturned'].includes(decision) && assessment.type === 'rpl') {
      const assessorCompletedCount = await Assessment.countDocuments({
        assessor: assessment.assessor,
        status: { $in: ['approved', 'rejected'] },
        completedAt: { $exists: true },
      });

      if (requiresExternalModeration(assessment, assessorCompletedCount)) {
        assessment.rpl.externalModeration = {
          required: true,
          status: 'pending',
        };
        assessment.status = 'awaiting-external-moderation';
        // Don't clean up assessorDecision yet — external moderator needs it
      } else {
        // No external moderation needed — clean up
        assessment.rpl.assessorDecision = undefined;
      }
    } else {
      // referred-back — clean up
      assessment.rpl.assessorDecision = undefined;
    }

    await assessment.save();

    // xAPI: assessment completed after moderation (fire-and-forget)
    if (['approved', 'rejected'].includes(assessment.status)) {
      emitAssessmentCompleted(assessment.worker, assessment._id, assessment.trade || 'RPL Assessment', assessment.score).catch(() => {});
    }

    const populated = await Assessment.findById(assessment._id)
      .populate('worker', 'fullName trade')
      .populate('assessor', 'name')
      .populate('rpl.moderation.moderator', 'name');

    res.json(populated || assessment);
  } catch (err) { next(err); }
});

// Gap 8: External moderator reviews assessment
router.put('/:id/external-moderate', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('decision').isIn(['endorsed', 'overturned', 'referred-back']).withMessage('Invalid decision'),
  body('comments').optional().trim().isLength({ max: 2000 }),
  body('qualityScore').isInt({ min: 1, max: 5 }).toInt(),
  body('findings').optional().isArray(),
  handleValidation,
], auditLog('ASSESSMENT_EXTERNAL_MODERATE'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    if (assessment.status !== 'awaiting-external-moderation') {
      return res.status(400).json({ error: 'Assessment is not awaiting external moderation' });
    }

    // External moderator must be different from both assessor AND internal moderator
    if (assessment.assessor.toString() === req.user._id.toString()) {
      return res.status(403).json({ error: 'The assessor cannot externally moderate their own assessment.' });
    }
    if (assessment.rpl?.moderation?.moderator?.toString() === req.user._id.toString()) {
      return res.status(403).json({ error: 'The internal moderator cannot also be the external moderator.' });
    }

    const { decision, comments, qualityScore, findings } = req.body;

    assessment.rpl.externalModeration = {
      required: true,
      status: 'completed',
      moderator: req.user._id,
      assignedAt: assessment.rpl.externalModeration?.assignedAt || new Date(),
      decision,
      comments: comments || '',
      completedAt: new Date(),
      qualityScore,
      findings: findings || [],
      assessorConsistencyFlag: qualityScore <= 2,
    };

    // Determine the final outcome based on internal + external moderation
    const internalDecision = assessment.rpl.moderation?.decision;
    const assessorOriginal = assessment.rpl.assessorDecision || 'approved';

    if (decision === 'endorsed') {
      // External moderator agrees with internal moderation outcome
      if (internalDecision === 'endorsed') {
        assessment.status = assessorOriginal;
      } else if (internalDecision === 'overturned') {
        assessment.status = assessorOriginal === 'approved' ? 'rejected' : 'approved';
      }
      assessment.completedAt = new Date();

      if (assessment.status === 'approved') {
        const worker = await Worker.findById(assessment.worker);
        if (worker) { worker.status = 'assessed'; await worker.save(); }
      }
      if (assessment.status === 'rejected') {
        await generateGapTraining(assessment);
      }
    } else if (decision === 'overturned') {
      // External moderator disagrees — reverse the internal moderation outcome
      if (internalDecision === 'endorsed') {
        assessment.status = assessorOriginal === 'approved' ? 'rejected' : 'approved';
      } else {
        assessment.status = assessorOriginal;
      }
      assessment.completedAt = new Date();

      if (assessment.status === 'approved') {
        const worker = await Worker.findById(assessment.worker);
        if (worker) { worker.status = 'assessed'; await worker.save(); }
      }
      if (assessment.status === 'rejected') {
        await generateGapTraining(assessment);
      }
    } else if (decision === 'referred-back') {
      // Send back for complete re-evaluation
      assessment.status = 'needs-revision';
    }

    assessment.rpl.assessorDecision = undefined;
    await assessment.save();

    // xAPI: assessment completed after external moderation (fire-and-forget)
    if (['approved', 'rejected'].includes(assessment.status)) {
      emitAssessmentCompleted(assessment.worker, assessment._id, assessment.trade || 'RPL Assessment', assessment.score).catch(() => {});
    }

    const populated = await Assessment.findById(assessment._id)
      .populate('worker', 'fullName trade')
      .populate('assessor', 'name')
      .populate('rpl.moderation.moderator', 'name')
      .populate('rpl.externalModeration.moderator', 'name');

    res.json(populated || assessment);
  } catch (err) { next(err); }
});

// Issue #9: Worker appeals a rejected RPL
router.post('/:id/appeal', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('reason').trim().notEmpty().withMessage('Appeal reason is required').isLength({ max: 2000 }),
  handleValidation,
], auditLog('ASSESSMENT_APPEAL'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    if (assessment.type !== 'rpl') {
      return res.status(400).json({ error: 'Appeals are only available for RPL assessments' });
    }

    if (!['rejected', 'needs-revision'].includes(assessment.status)) {
      return res.status(400).json({ error: 'Only rejected or needs-revision assessments can be appealed' });
    }

    // Existing appeal check
    if (assessment.rpl?.appeal?.decision === 'pending') {
      return res.status(400).json({ error: 'An appeal is already pending for this assessment' });
    }

    // 14-day appeal window
    if (assessment.completedAt) {
      const daysSinceDecision = (Date.now() - new Date(assessment.completedAt).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceDecision > 14) {
        return res.status(400).json({ error: 'Appeal window has closed. Appeals must be filed within 14 days of the decision.' });
      }
    }

    // Verify the worker owns this assessment
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.appeal = {
      appealedBy: req.user._id,
      reason: req.body.reason,
      appealedAt: new Date(),
      decision: 'pending',
    };
    assessment.status = 'appealed';
    await assessment.save();
    res.json(assessment);
  } catch (err) { next(err); }
});

// Issue #9: Review an appeal (admin/institution only, different from original assessor)
router.put('/:id/appeal-review', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('decision').isIn(['upheld', 'overturned', 'partial']).withMessage('Invalid appeal decision'),
  body('reviewComments').trim().notEmpty().withMessage('Review comments are required').isLength({ max: 2000 }),
  body('newScore').optional().isFloat({ min: 0, max: 100 }),
  handleValidation,
], auditLog('ASSESSMENT_APPEAL_REVIEW'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    if (assessment.status !== 'appealed') {
      return res.status(400).json({ error: 'Assessment does not have a pending appeal' });
    }

    // Appeal reviewer must be different from original assessor
    if (assessment.assessor.toString() === req.user._id.toString()) {
      return res.status(403).json({ error: 'The original assessor cannot review appeals. A different reviewer is required.' });
    }

    const { decision, reviewComments, newScore } = req.body;

    assessment.rpl.appeal.reviewedBy = req.user._id;
    assessment.rpl.appeal.decision = decision;
    assessment.rpl.appeal.reviewComments = reviewComments;
    assessment.rpl.appeal.reviewedAt = new Date();

    if (decision === 'overturned') {
      // Reverse the rejection — approve
      assessment.status = 'approved';
      assessment.completedAt = new Date();
      if (newScore !== undefined) assessment.score = newScore;
      const worker = await Worker.findById(assessment.worker);
      if (worker) {
        worker.status = 'assessed';
        await worker.save();
      }
    } else if (decision === 'partial') {
      // Partial — send back for re-assessment with modifications
      assessment.status = 'needs-revision';
      assessment.feedback = `Appeal partially upheld: ${reviewComments}`;
    } else {
      // Upheld — original rejection stands
      assessment.status = 'rejected';
      await generateGapTraining(assessment);
    }

    await assessment.save();

    // xAPI: assessment completed after appeal review (fire-and-forget)
    if (['approved', 'rejected'].includes(assessment.status)) {
      emitAssessmentCompleted(assessment.worker, assessment._id, assessment.trade || 'RPL Assessment', assessment.score).catch(() => {});
    }
    res.json(assessment);
  } catch (err) { next(err); }
});

// Issue #6 & #15: Get gap training recommendations for an assessment
router.get('/:id/gap-training', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .populate('rpl.gapTraining.recommendedTraining', 'title trade nqfLevel duration institution status');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    res.json({ gapTraining: assessment.rpl?.gapTraining || [] });
  } catch (err) { next(err); }
});

// Issue #15: Enroll worker in recommended gap training
router.post('/:id/gap-training/:index/enroll', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  param('index').isInt({ min: 0 }).toInt(),
  handleValidation,
], auditLog('GAP_TRAINING_ENROLL'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const gap = assessment.rpl?.gapTraining?.[req.params.index];
    if (!gap) return res.status(404).json({ error: 'Gap training recommendation not found' });
    if (!gap.recommendedTraining) return res.status(400).json({ error: 'No training program linked to this recommendation' });
    if (gap.enrolled) return res.status(409).json({ error: 'Worker already enrolled in this training' });

    // Enroll the worker in the training program
    const result = await Training.findOneAndUpdate(
      {
        _id: gap.recommendedTraining,
        'enrollments.worker': { $ne: assessment.worker },
        $expr: { $lt: [{ $size: '$enrollments' }, '$maxEnrollment'] },
      },
      { $push: { enrollments: { worker: assessment.worker } } },
      { new: true },
    );

    if (!result) {
      const program = await Training.findById(gap.recommendedTraining);
      if (!program) return res.status(404).json({ error: 'Training program not found' });
      const existing = program.enrollments.find(e => e.worker.toString() === assessment.worker.toString());
      if (existing) return res.status(409).json({ error: 'Already enrolled in this program' });
      return res.status(400).json({ error: 'Training program is full' });
    }

    // Update the gap training record
    assessment.rpl.gapTraining[req.params.index].enrolled = true;
    assessment.rpl.gapTraining[req.params.index].enrolledAt = new Date();
    await assessment.save();

    res.json({ message: 'Worker enrolled in gap training', gapTraining: assessment.rpl.gapTraining });
  } catch (err) { next(err); }
});

// Issue #6 & #15: Helper — generate gap training recommendations based on interview & demo scores
async function generateGapTraining(assessment) {
  const gapAreas = [];
  // Collect low-scoring areas from interview
  if (assessment.rpl?.interview?.items) {
    for (const item of assessment.rpl.interview.items) {
      if (item.score < 2) {
        gapAreas.push({
          competencyArea: item.competencyArea,
          currentLevel: item.score === 0 ? 'not-demonstrated' : 'novice',
          requiredLevel: 'competent',
        });
      }
    }
  }
  // Collect low-scoring areas from practical demo
  if (assessment.rpl?.practicalDemo?.rubric) {
    for (const item of assessment.rpl.practicalDemo.rubric) {
      if (item.score < 2) {
        const existing = gapAreas.find(g => g.competencyArea === item.criterion);
        if (!existing) {
          gapAreas.push({
            competencyArea: item.criterion,
            currentLevel: item.score === 0 ? 'not-demonstrated' : 'novice',
            requiredLevel: 'competent',
          });
        }
      }
    }
  }

  if (gapAreas.length === 0) return;

  // Find training programs that target these specific skills
  const programs = await Training.find({
    trade: assessment.trade,
    status: 'active',
  }).select('title competencyTargets modules.title modules.competencies').limit(20);

  // Match gap areas to programs by competency targets
  const recommendations = [];
  for (const gap of gapAreas) {
    let bestMatch = null;
    let bestScore = 0;

    for (const prog of programs) {
      // Check program competency targets
      const targetMatch = prog.competencyTargets?.find(ct =>
        ct.skill.toLowerCase().includes(gap.competencyArea.toLowerCase()) ||
        gap.competencyArea.toLowerCase().includes(ct.skill.toLowerCase())
      );
      if (targetMatch) {
        const score = 2;
        if (score > bestScore) { bestScore = score; bestMatch = prog; }
      }
      // Check module-level competencies
      for (const mod of (prog.modules || [])) {
        const modMatch = mod.competencies?.find(c =>
          c.skill.toLowerCase().includes(gap.competencyArea.toLowerCase()) ||
          gap.competencyArea.toLowerCase().includes(c.skill.toLowerCase())
        );
        if (modMatch && !bestMatch) {
          bestScore = 1;
          bestMatch = prog;
        }
      }
    }

    // Fallback: first active program for the trade
    if (!bestMatch && programs.length > 0) {
      bestMatch = programs[0];
    }

    if (bestMatch) {
      recommendations.push({
        ...gap,
        recommendedTraining: bestMatch._id,
        recommendedTrainingTitle: bestMatch.title,
      });
    }
  }

  assessment.rpl.gapTraining = recommendations;
  await assessment.save();
}

// ═══════════════════════════════════════════════════════════════
// PHASE 1 RPL GAP IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════

// ------------------------------------------------------------------
// Gap #33: Submit candidate consent/agreement form
// ------------------------------------------------------------------
router.put('/:id/consent', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('consentItems.evidenceUsage').isBoolean().withMessage('Evidence usage consent required'),
  body('consentItems.dataHandling').isBoolean().withMessage('Data handling consent required'),
  body('consentItems.thirdPartySharing').isBoolean().withMessage('Third party sharing consent required'),
  body('consentItems.photoVideoConsent').isBoolean().withMessage('Photo/video consent required'),
  body('consentItems.appealRights').isBoolean().withMessage('Appeal rights acknowledgment required'),
  handleValidation,
], auditLog('RPL_CONSENT_SUBMIT'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Consent is only required for RPL assessments' });

    // Only the worker themselves or admin can submit consent
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    } else if (!['admin', 'institution'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only the candidate or admin can submit consent' });
    }

    // All consent items must be true
    const items = req.body.consentItems;
    if (!items.evidenceUsage || !items.dataHandling || !items.thirdPartySharing ||
        !items.photoVideoConsent || !items.appealRights) {
      return res.status(400).json({ error: 'All consent items must be agreed to before proceeding' });
    }

    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.consent = {
      agreed: true,
      agreedAt: new Date(),
      agreedBy: req.user._id,
      version: '1.0',
      consentItems: items,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')?.substring(0, 500),
    };
    await assessment.save();

    // Send notification
    const worker = await Worker.findById(assessment.worker).populate('user', 'email');
    if (worker?.user) {
      createRPLNotification({ recipientUserId: worker.user._id || worker.user, stage: 'consent-submitted', assessment, worker }).catch(() => {});
    }

    res.json({ message: 'Consent recorded successfully', consent: assessment.rpl.consent });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #33: Get consent status
// ------------------------------------------------------------------
router.get('/:id/consent', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id).select('rpl.consent worker type');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    res.json({
      consentRequired: assessment.type === 'rpl',
      consentGiven: assessment.rpl?.consent?.agreed || false,
      consent: assessment.rpl?.consent || null,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #5: Get RPL timeline/duration tracking
// ------------------------------------------------------------------
router.get('/:id/timeline', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.timeline rpl.stageCompleted rpl.estimatedCompletionDate rpl.actualCompletionDate status createdAt completedAt type trade');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    // Calculate overall progress
    const stages = assessment.rpl?.stageCompleted || {};
    const stageNames = ['preScreening', 'evidenceSubmission', 'documentReview', 'interview', 'practicalDemo', 'finalDecision'];
    const completedStages = stageNames.filter(s => stages[s]).length;
    const currentStage = stageNames.find(s => !stages[s]) || 'completed';

    // Calculate elapsed days
    const elapsedDays = Math.ceil((Date.now() - new Date(assessment.createdAt).getTime()) / (1000 * 60 * 60 * 24));

    // Default estimated durations per stage (in days)
    const defaultEstimates = {
      'pre-screening': 1, 'evidence-submission': 7, 'document-review': 3,
      'interview': 2, 'practical-demo': 2, 'final-decision': 1,
      'moderation': 3, 'external-moderation': 5, 'appeal': 14,
    };
    const totalEstimatedDays = Object.values(defaultEstimates).slice(0, 6).reduce((a, b) => a + b, 0);

    res.json({
      assessmentId: assessment._id,
      trade: assessment.trade,
      status: assessment.status,
      progress: {
        completedStages,
        totalStages: stageNames.length,
        percentComplete: Math.round((completedStages / stageNames.length) * 100),
        currentStage,
      },
      timeline: assessment.rpl?.timeline || [],
      estimatedCompletionDate: assessment.rpl?.estimatedCompletionDate,
      actualCompletionDate: assessment.rpl?.actualCompletionDate,
      elapsedDays,
      totalEstimatedDays,
      stageEstimates: defaultEstimates,
      createdAt: assessment.createdAt,
      completedAt: assessment.completedAt,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #10: Upload video evidence for RPL portfolio
// ------------------------------------------------------------------
router.post('/:id/video-evidence', authenticate, upload.single('video'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], auditLog('RPL_VIDEO_EVIDENCE'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Video evidence is only for RPL assessments' });

    // Only the worker or admin can upload video evidence
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else if (!['admin', 'assessor', 'institution'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Consent check
    if (!assessment.rpl?.consent?.agreed) {
      return res.status(400).json({ error: 'Candidate must submit consent form before uploading video evidence' });
    }

    if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });

    // Validate video MIME type
    if (!ALLOWED_MIME.video.includes(req.file.mimetype)) {
      return res.status(400).json({ error: 'Invalid video format. Allowed: MP4, MOV, AVI, WebM' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase().replace('.', '');
    const videoEntry = {
      filename: req.file.filename,
      url: `/api/uploads/${req.file.filename}`,
      uploadedAt: new Date(),
      duration: req.body.duration ? Number(req.body.duration) : undefined,
      format: ['mp4', 'mov', 'avi', 'webm'].includes(ext) ? ext : 'mp4',
      fileSize: req.file.size,
      description: req.body.description?.substring(0, 500),
      competencyArea: req.body.competencyArea?.substring(0, 200),
    };

    if (!assessment.rpl) assessment.rpl = {};
    if (!assessment.rpl.videoEvidence) assessment.rpl.videoEvidence = [];

    // Limit to 10 video evidences
    if (assessment.rpl.videoEvidence.length >= 10) {
      return res.status(400).json({ error: 'Maximum 10 video evidence files allowed per assessment' });
    }

    assessment.rpl.videoEvidence.push(videoEntry);
    await assessment.save();

    // xAPI event
    emitRPLEvidenceSubmitted(assessment.worker, assessment._id, assessment.trade, 'video-evidence').catch(() => {});

    // Notification to assessor
    createRPLNotification({
      recipientUserId: assessment.assessor,
      stage: 'evidence-submission',
      assessment,
      details: `Video evidence uploaded: ${videoEntry.description || videoEntry.filename}`,
    }).catch(() => {});

    res.status(201).json({
      message: 'Video evidence uploaded successfully',
      videoEvidence: assessment.rpl.videoEvidence,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #10: Assessor reviews video evidence
// ------------------------------------------------------------------
router.put('/:id/video-evidence/:index/review', authenticate, authorize('admin', 'assessor'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  param('index').isInt({ min: 0 }).toInt(),
  body('assessorNotes').trim().notEmpty().withMessage('Assessor notes required').isLength({ max: 1000 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const video = assessment.rpl?.videoEvidence?.[req.params.index];
    if (!video) return res.status(404).json({ error: 'Video evidence not found at this index' });

    assessment.rpl.videoEvidence[req.params.index].reviewedByAssessor = true;
    assessment.rpl.videoEvidence[req.params.index].assessorNotes = req.body.assessorNotes;
    await assessment.save();

    // Notify worker
    const worker = await Worker.findById(assessment.worker).populate('user', 'email');
    if (worker?.user) {
      createRPLNotification({
        recipientUserId: worker.user._id || worker.user,
        stage: 'video-evidence-reviewed',
        assessment,
        worker,
        details: `Your video evidence "${video.description || video.filename}" has been reviewed.`,
      }).catch(() => {});
    }

    res.json({ message: 'Video evidence reviewed', videoEvidence: assessment.rpl.videoEvidence });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #29: Update competency unit status (partial RPL recognition)
// ------------------------------------------------------------------
router.put('/:id/competency-units', authenticate, authorize('admin', 'assessor'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('units').isArray({ min: 1 }).withMessage('Competency units array required'),
  body('units.*.unitCode').trim().notEmpty().withMessage('Unit code required'),
  body('units.*.unitTitle').trim().notEmpty().withMessage('Unit title required'),
  body('units.*.status').isIn(['not-assessed', 'competent', 'not-yet-competent', 'partially-competent']).withMessage('Invalid unit status'),
  body('units.*.nqfLevel').optional().isInt({ min: 1, max: 8 }).toInt(),
  body('units.*.interviewScore').optional().isFloat({ min: 0, max: 4 }),
  body('units.*.demoScore').optional().isFloat({ min: 0, max: 4 }),
  body('units.*.evidenceSufficient').optional().isBoolean(),
  body('units.*.notes').optional().trim().isLength({ max: 1000 }),
  handleValidation,
], auditLog('RPL_COMPETENCY_UNITS'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Competency units only apply to RPL assessments' });

    if (!assessment.rpl) assessment.rpl = {};

    const updatedUnits = req.body.units.map(u => ({
      unitCode: u.unitCode,
      unitTitle: u.unitTitle,
      nqfLevel: u.nqfLevel,
      status: u.status,
      assessedAt: u.status !== 'not-assessed' ? new Date() : undefined,
      assessedBy: u.status !== 'not-assessed' ? req.user._id : undefined,
      interviewScore: u.interviewScore,
      demoScore: u.demoScore,
      evidenceSufficient: u.evidenceSufficient,
      notes: u.notes,
    }));

    assessment.rpl.competencyUnits = updatedUnits;

    // Calculate partial recognition
    const totalUnits = updatedUnits.length;
    const achievedUnits = updatedUnits.filter(u => u.status === 'competent').length;
    assessment.rpl.partialRecognition = {
      eligible: achievedUnits > 0 && achievedUnits < totalUnits,
      unitsAchieved: achievedUnits,
      totalUnits,
      percentComplete: Math.round((achievedUnits / totalUnits) * 100),
      statementOfAttainmentIssued: assessment.rpl.partialRecognition?.statementOfAttainmentIssued || false,
      statementIssuedAt: assessment.rpl.partialRecognition?.statementIssuedAt,
    };

    await assessment.save();

    // Notify worker of partial recognition
    if (assessment.rpl.partialRecognition.eligible) {
      const worker = await Worker.findById(assessment.worker).populate('user', 'email');
      if (worker?.user) {
        createRPLNotification({
          recipientUserId: worker.user._id || worker.user,
          stage: 'partial-recognition',
          assessment,
          worker,
          details: `You have achieved ${achievedUnits} of ${totalUnits} competency units (${assessment.rpl.partialRecognition.percentComplete}%).`,
        }).catch(() => {});
      }
    }

    res.json({
      message: 'Competency units updated',
      competencyUnits: assessment.rpl.competencyUnits,
      partialRecognition: assessment.rpl.partialRecognition,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #29: Get partial recognition status
// ------------------------------------------------------------------
router.get('/:id/partial-recognition', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.competencyUnits rpl.partialRecognition type trade worker')
      .populate('rpl.competencyUnits.assessedBy', 'name');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    res.json({
      competencyUnits: assessment.rpl?.competencyUnits || [],
      partialRecognition: assessment.rpl?.partialRecognition || { eligible: false, unitsAchieved: 0, totalUnits: 0, percentComplete: 0 },
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #29: Issue statement of attainment for partial recognition
// ------------------------------------------------------------------
router.post('/:id/statement-of-attainment', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], auditLog('RPL_STATEMENT_OF_ATTAINMENT'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Only RPL assessments support statements of attainment' });

    const pr = assessment.rpl?.partialRecognition;
    if (!pr?.eligible) return res.status(400).json({ error: 'No partial recognition eligible — either all or no units achieved' });
    if (pr.statementOfAttainmentIssued) return res.status(409).json({ error: 'Statement of attainment already issued' });

    assessment.rpl.partialRecognition.statementOfAttainmentIssued = true;
    assessment.rpl.partialRecognition.statementIssuedAt = new Date();
    await assessment.save();

    // Update worker competencies with achieved units
    const worker = await Worker.findById(assessment.worker);
    if (worker) {
      const achievedUnits = assessment.rpl.competencyUnits.filter(u => u.status === 'competent');
      for (const unit of achievedUnits) {
        const existing = worker.competencies?.find(c => c.code === unit.unitCode);
        if (!existing) {
          worker.competencies.push({
            code: unit.unitCode,
            title: unit.unitTitle,
            nqfLevel: unit.nqfLevel || assessment.rpl?.preScreening?.recommendedLevel,
            proficiency: 'competent',
            assessedDate: unit.assessedAt,
            assessedBy: unit.assessedBy,
          });
        }
      }
      await worker.save();
    }

    res.json({
      message: 'Statement of attainment issued',
      partialRecognition: assessment.rpl.partialRecognition,
      unitsOnRecord: assessment.rpl.competencyUnits.filter(u => u.status === 'competent').length,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #23: Check expiring RPL credentials
// ------------------------------------------------------------------
router.get('/credential-expiry/check', authenticate, authorize('admin', 'institution'), [
  query('daysAhead').optional().isInt({ min: 1, max: 365 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const daysAhead = req.query.daysAhead || 90;
    const cutoffDate = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);

    const expiringCredentials = await Credential.find({
      status: 'active',
      validUntil: { $lte: cutoffDate, $gte: new Date() },
    })
      .sort('validUntil')
      .populate('worker', 'fullName trade registrationId')
      .populate('issuedBy', 'name');

    const expiredCredentials = await Credential.find({
      status: 'active',
      validUntil: { $lt: new Date() },
    })
      .sort('validUntil')
      .populate('worker', 'fullName trade registrationId');

    // Auto-expire credentials
    if (expiredCredentials.length > 0) {
      await Credential.updateMany(
        { _id: { $in: expiredCredentials.map(c => c._id) } },
        { status: 'expired' },
      );
    }

    const grouped = {
      critical: expiringCredentials.filter(c => {
        const days = Math.ceil((c.validUntil - Date.now()) / (1000 * 60 * 60 * 24));
        return days <= 7;
      }),
      warning: expiringCredentials.filter(c => {
        const days = Math.ceil((c.validUntil - Date.now()) / (1000 * 60 * 60 * 24));
        return days > 7 && days <= 30;
      }),
      upcoming: expiringCredentials.filter(c => {
        const days = Math.ceil((c.validUntil - Date.now()) / (1000 * 60 * 60 * 24));
        return days > 30;
      }),
    };

    res.json({
      summary: {
        totalExpiring: expiringCredentials.length,
        justExpired: expiredCredentials.length,
        critical: grouped.critical.length,
        warning: grouped.warning.length,
        upcoming: grouped.upcoming.length,
      },
      critical: grouped.critical,
      warning: grouped.warning,
      upcoming: grouped.upcoming,
      expired: expiredCredentials,
      daysAhead,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #23: Send expiry notifications (admin batch action)
// ------------------------------------------------------------------
router.post('/credential-expiry/notify', authenticate, authorize('admin', 'institution'), [
  body('daysThreshold').optional().isInt({ min: 1, max: 90 }).toInt(),
  handleValidation,
], async (req, res, next) => {
  try {
    const daysThreshold = req.body.daysThreshold || 30;
    const cutoffDate = new Date(Date.now() + daysThreshold * 24 * 60 * 60 * 1000);

    const expiring = await Credential.find({
      status: 'active',
      validUntil: { $lte: cutoffDate, $gte: new Date() },
    }).populate({ path: 'worker', populate: { path: 'user', select: 'email _id' } });

    let notified = 0;
    for (const cred of expiring) {
      const daysRemaining = Math.ceil((cred.validUntil - Date.now()) / (1000 * 60 * 60 * 24));
      if (cred.worker?.user) {
        await createRPLNotification({
          recipientUserId: cred.worker.user._id || cred.worker.user,
          stage: 'credential-expiring',
          details: `Your credential "${cred.title}" expires in ${daysRemaining} days (${cred.validUntil.toISOString().split('T')[0]}).`,
          worker: cred.worker,
        }).catch(() => {});
        notified++;
      }
    }

    res.json({ message: `Expiry notifications sent to ${notified} credential holders`, total: expiring.length, notified });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #5: Update timeline entry (assessor/admin records stage timing)
// ------------------------------------------------------------------
router.post('/:id/timeline', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('stage').isIn(['pre-screening', 'evidence-submission', 'document-review', 'interview', 'practical-demo', 'final-decision', 'moderation', 'external-moderation', 'appeal']).withMessage('Invalid stage'),
  body('startedAt').optional().isISO8601(),
  body('completedAt').optional().isISO8601(),
  body('estimatedDurationDays').optional().isInt({ min: 1, max: 365 }).toInt(),
  body('notes').optional().trim().isLength({ max: 500 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Timeline tracking is only for RPL assessments' });

    if (!assessment.rpl) assessment.rpl = {};
    if (!assessment.rpl.timeline) assessment.rpl.timeline = [];

    const { stage, startedAt, completedAt, estimatedDurationDays, notes } = req.body;

    // Find existing entry for this stage or create new
    const existingIdx = assessment.rpl.timeline.findIndex(t => t.stage === stage);
    const entry = {
      stage,
      startedAt: startedAt ? new Date(startedAt) : (existingIdx >= 0 ? assessment.rpl.timeline[existingIdx].startedAt : new Date()),
      completedAt: completedAt ? new Date(completedAt) : undefined,
      estimatedDurationDays,
      assignedTo: req.user._id,
      notes,
    };

    // Calculate actual duration if both dates present
    if (entry.startedAt && entry.completedAt) {
      entry.actualDurationDays = Math.ceil((new Date(entry.completedAt) - new Date(entry.startedAt)) / (1000 * 60 * 60 * 24));
    }

    if (existingIdx >= 0) {
      assessment.rpl.timeline[existingIdx] = entry;
    } else {
      assessment.rpl.timeline.push(entry);
    }

    // Recalculate estimated completion date
    const remainingStages = ['pre-screening', 'evidence-submission', 'document-review', 'interview', 'practical-demo', 'final-decision'];
    const defaultDays = { 'pre-screening': 1, 'evidence-submission': 7, 'document-review': 3, 'interview': 2, 'practical-demo': 2, 'final-decision': 1 };
    let remainingDays = 0;
    for (const s of remainingStages) {
      const existing = assessment.rpl.timeline.find(t => t.stage === s);
      if (!existing?.completedAt) {
        remainingDays += existing?.estimatedDurationDays || defaultDays[s] || 3;
      }
    }
    assessment.rpl.estimatedCompletionDate = new Date(Date.now() + remainingDays * 24 * 60 * 60 * 1000);

    await assessment.save();
    res.json({ message: 'Timeline updated', timeline: assessment.rpl.timeline, estimatedCompletionDate: assessment.rpl.estimatedCompletionDate });
  } catch (err) { next(err); }
});

// ═══════════════════════════════════════════════════════════════
// PHASE 2 RPL GAP IMPLEMENTATIONS
// ═══════════════════════════════════════════════════════════════

// ------------------------------------------------------------------
// Gap #1: Get RPL readiness guide for a trade
// ------------------------------------------------------------------
router.get('/readiness-guide/:trade', authenticate, async (req, res, next) => {
  try {
    const trade = req.params.trade;
    const guide = RPL_READINESS_GUIDES[trade] || RPL_READINESS_GUIDES.default;
    res.json({ trade, guide });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #1: Acknowledge readiness guide (marks as read for an assessment)
// ------------------------------------------------------------------
router.put('/:id/readiness-guide/acknowledge', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('sectionsRead').isArray({ min: 1 }).withMessage('At least one section must be read'),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Readiness guide only applies to RPL assessments' });

    if (!assessment.rpl) assessment.rpl = {};
    const currentSections = assessment.rpl.readinessGuide?.sectionsRead || [];
    const allSections = [...new Set([...currentSections, ...req.body.sectionsRead])];

    assessment.rpl.readinessGuide = {
      acknowledged: allSections.length >= 4,
      acknowledgedAt: allSections.length >= 4 ? new Date() : undefined,
      version: '1.0',
      sectionsRead: allSections,
    };
    await assessment.save();

    res.json({
      message: allSections.length >= 4 ? 'Readiness guide acknowledged' : 'Progress saved',
      readinessGuide: assessment.rpl.readinessGuide,
      sectionsRead: allSections.length,
      totalSections: (RPL_READINESS_GUIDES[assessment.trade] || RPL_READINESS_GUIDES.default).sections.length,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #2: Get evidence preparation checklist for a trade
// ------------------------------------------------------------------
router.get('/evidence-checklist/:trade', authenticate, async (req, res, next) => {
  try {
    const trade = req.params.trade;
    const checklist = EVIDENCE_CHECKLIST_TEMPLATES[trade] || EVIDENCE_CHECKLIST_TEMPLATES.default;
    const required = checklist.filter(i => i.required).length;
    const optional = checklist.filter(i => !i.required).length;
    res.json({ trade, checklist, summary: { total: checklist.length, required, optional } });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #2: Update evidence checklist progress for an assessment
// ------------------------------------------------------------------
router.put('/:id/evidence-checklist', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('items').isArray({ min: 1 }).withMessage('Checklist items array required'),
  body('items.*.itemId').trim().notEmpty().withMessage('Item ID required'),
  body('items.*.prepared').isBoolean().withMessage('Prepared flag required'),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Evidence checklist only applies to RPL assessments' });

    // Ownership check
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    if (!assessment.rpl) assessment.rpl = {};
    const template = EVIDENCE_CHECKLIST_TEMPLATES[assessment.trade] || EVIDENCE_CHECKLIST_TEMPLATES.default;

    // Merge submitted items with template
    const updatedItems = template.map(t => {
      const submitted = req.body.items.find(i => i.itemId === t.itemId);
      const existing = assessment.rpl.evidenceChecklist?.find(e => e.itemId === t.itemId);
      return {
        itemId: t.itemId,
        title: t.title,
        description: t.description,
        required: t.required,
        prepared: submitted ? submitted.prepared : (existing?.prepared || false),
        preparedAt: submitted?.prepared ? new Date() : existing?.preparedAt,
        notes: submitted?.notes || existing?.notes,
      };
    });

    assessment.rpl.evidenceChecklist = updatedItems;

    // Check if all required items are prepared
    const requiredItems = updatedItems.filter(i => i.required);
    assessment.rpl.evidenceChecklistCompleted = requiredItems.every(i => i.prepared);

    await assessment.save();

    const prepared = updatedItems.filter(i => i.prepared).length;
    const requiredDone = requiredItems.filter(i => i.prepared).length;

    res.json({
      message: assessment.rpl.evidenceChecklistCompleted ? 'All required evidence prepared!' : 'Checklist updated',
      evidenceChecklist: assessment.rpl.evidenceChecklist,
      completed: assessment.rpl.evidenceChecklistCompleted,
      summary: { total: updatedItems.length, prepared, requiredTotal: requiredItems.length, requiredPrepared: requiredDone },
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #6: Start challenge exam (generates questions for candidate)
// ------------------------------------------------------------------
router.post('/:id/challenge-exam/start', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], auditLog('RPL_CHALLENGE_EXAM_START'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Challenge exam only applies to RPL assessments' });

    // Ownership check — only the worker can start their own exam
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    // Check if exam already started
    if (assessment.rpl?.challengeExam?.started) {
      // If completed, reject restart
      if (assessment.rpl.challengeExam.completed) {
        return res.status(409).json({ error: 'Challenge exam already completed', result: assessment.rpl.challengeExam });
      }
      // If still in progress, return existing questions
      const template = KNOWLEDGE_TEST_TEMPLATES[assessment.trade] || KNOWLEDGE_TEST_TEMPLATES.default;
      const questions = template.map((q, i) => {
        const clean = { index: i, question: q.question, type: q.type, points: q.points || 1 };
        if (q.type === 'mcq') clean.options = q.options;
        return clean;
      });
      return res.json({
        message: 'Exam already in progress',
        startedAt: assessment.rpl.challengeExam.startedAt,
        timeLimitMinutes: assessment.rpl.challengeExam.timeLimitMinutes,
        questions,
      });
    }

    // Gate check: pre-screening should be done
    if (!assessment.rpl?.stageCompleted?.preScreening) {
      return res.status(400).json({ error: 'Pre-screening must be completed before starting the challenge exam' });
    }

    const template = KNOWLEDGE_TEST_TEMPLATES[assessment.trade] || KNOWLEDGE_TEST_TEMPLATES.default;
    const totalPoints = template.reduce((sum, q) => sum + (q.points || 1), 0);

    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.challengeExam = {
      started: true,
      startedAt: new Date(),
      completed: false,
      timeLimitMinutes: 60,
      totalQuestions: template.length,
      totalPoints,
      passingScore: 60,
      answers: [],
    };
    await assessment.save();

    // Return questions without correct answers
    const questions = template.map((q, i) => {
      const clean = { index: i, question: q.question, type: q.type, points: q.points || 1 };
      if (q.type === 'mcq') clean.options = q.options;
      return clean;
    });

    res.json({
      message: 'Challenge exam started',
      startedAt: assessment.rpl.challengeExam.startedAt,
      timeLimitMinutes: 60,
      totalQuestions: template.length,
      totalPoints,
      passingScore: 60,
      questions,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #6: Submit challenge exam answers
// ------------------------------------------------------------------
router.put('/:id/challenge-exam/submit', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('answers').isArray({ min: 1 }).withMessage('Answers array required'),
  handleValidation,
], auditLog('RPL_CHALLENGE_EXAM_SUBMIT'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Challenge exam only applies to RPL assessments' });

    // Ownership check
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    if (!assessment.rpl?.challengeExam?.started) {
      return res.status(400).json({ error: 'Challenge exam has not been started' });
    }
    if (assessment.rpl.challengeExam.completed) {
      return res.status(409).json({ error: 'Challenge exam already submitted' });
    }

    // Check time limit
    const elapsed = (Date.now() - new Date(assessment.rpl.challengeExam.startedAt).getTime()) / 1000;
    const timeLimitSec = assessment.rpl.challengeExam.timeLimitMinutes * 60;
    if (elapsed > timeLimitSec + 60) { // 60s grace period
      return res.status(400).json({ error: 'Time limit exceeded' });
    }

    const template = KNOWLEDGE_TEST_TEMPLATES[assessment.trade] || KNOWLEDGE_TEST_TEMPLATES.default;
    let earnedPoints = 0;
    let correctAnswers = 0;

    const gradedAnswers = req.body.answers.map(a => {
      const q = template[a.questionIndex];
      if (!q) return { ...a, isCorrect: false, pointsEarned: 0 };

      let isCorrect = false;
      const points = q.points || 1;

      switch (q.type) {
        case 'mcq':
          isCorrect = a.selectedOption === q.correctOption;
          break;
        case 'true-false':
          isCorrect = String(a.textAnswer).toLowerCase() === q.correctAnswer.toLowerCase();
          break;
        case 'fill-blank':
          isCorrect = q.acceptableAnswers.some(ans =>
            String(a.textAnswer || '').toLowerCase().trim() === ans.toLowerCase().trim()
          );
          break;
        case 'short-answer': {
          const answer = String(a.textAnswer || '').toLowerCase().trim();
          isCorrect = q.acceptableAnswers.some(ans => {
            const words = ans.toLowerCase().split(/\s+/);
            const matched = words.filter(w => answer.includes(w));
            return matched.length >= Math.ceil(words.length * 0.5);
          });
          break;
        }
      }

      const pointsEarned = isCorrect ? points : 0;
      earnedPoints += pointsEarned;
      if (isCorrect) correctAnswers++;

      return {
        questionIndex: a.questionIndex,
        questionType: q.type,
        selectedOption: a.selectedOption,
        textAnswer: a.textAnswer,
        isCorrect,
        points,
        pointsEarned,
      };
    });

    const totalPoints = template.reduce((sum, q) => sum + (q.points || 1), 0);
    const score = Math.round((earnedPoints / totalPoints) * 100);
    const passed = score >= assessment.rpl.challengeExam.passingScore;

    assessment.rpl.challengeExam.completed = true;
    assessment.rpl.challengeExam.completedAt = new Date();
    assessment.rpl.challengeExam.timeTakenSeconds = Math.round(elapsed);
    assessment.rpl.challengeExam.answers = gradedAnswers;
    assessment.rpl.challengeExam.correctAnswers = correctAnswers;
    assessment.rpl.challengeExam.earnedPoints = earnedPoints;
    assessment.rpl.challengeExam.score = score;
    assessment.rpl.challengeExam.passed = passed;
    if (!assessment.rpl.stageCompleted) assessment.rpl.stageCompleted = {};
    assessment.rpl.stageCompleted.challengeExam = passed;

    // Determine credential tier
    assessment.rpl.credentialTier = determineCredentialTier(assessment);

    // Auto-record timeline
    if (!assessment.rpl.timeline) assessment.rpl.timeline = [];
    const existingTl = assessment.rpl.timeline.findIndex(t => t.stage === 'interview');
    if (existingTl < 0) {
      assessment.rpl.timeline.push({
        stage: 'interview',
        startedAt: assessment.rpl.challengeExam.startedAt,
        completedAt: new Date(),
        notes: `Challenge exam: ${score}% (${passed ? 'PASSED' : 'FAILED'})`,
      });
    }

    await assessment.save();

    // Notify assessor
    createRPLNotification({
      recipientUserId: assessment.assessor,
      stage: 'interview',
      assessment,
      details: `Challenge exam completed: ${score}% (${passed ? 'Passed' : 'Failed'})`,
    }).catch(() => {});

    res.json({
      message: passed ? 'Challenge exam passed!' : 'Challenge exam not passed',
      score,
      passed,
      correctAnswers,
      totalQuestions: template.length,
      earnedPoints,
      totalPoints,
      timeTakenSeconds: Math.round(elapsed),
      answers: gradedAnswers,
      credentialTier: assessment.rpl.credentialTier,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #6: Get challenge exam result
// ------------------------------------------------------------------
router.get('/:id/challenge-exam', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.challengeExam type trade');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const exam = assessment.rpl?.challengeExam;
    if (!exam?.started) {
      return res.json({ started: false, completed: false });
    }

    res.json({
      started: exam.started,
      completed: exam.completed,
      score: exam.score,
      passed: exam.passed,
      correctAnswers: exam.correctAnswers,
      totalQuestions: exam.totalQuestions,
      earnedPoints: exam.earnedPoints,
      totalPoints: exam.totalPoints,
      timeTakenSeconds: exam.timeTakenSeconds,
      startedAt: exam.startedAt,
      completedAt: exam.completedAt,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #7: Get credential tier for an assessment
// ------------------------------------------------------------------
router.get('/:id/credential-tier', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.credentialTier rpl.challengeExam.passed rpl.challengeExam.score rpl.practicalDemo.overallResult rpl.stageCompleted rpl.externalModeration type');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const tier = determineCredentialTier(assessment) || assessment.rpl?.credentialTier;
    const tierDescriptions = {
      'knowledge': 'Knowledge Certificate — Passed written knowledge test. Demonstrates theoretical understanding of trade principles.',
      'performance': 'Performance Certificate — Passed practical demonstration. Demonstrates hands-on competency in trade skills.',
      'certified-plus': 'Certified-Plus — Passed all stages including external moderation. Highest level of RPL recognition.',
    };

    res.json({
      tier: tier || 'none',
      description: tier ? tierDescriptions[tier] : 'Assessment incomplete or no tier achieved yet.',
      challengeExamPassed: assessment.rpl?.challengeExam?.passed || false,
      challengeExamScore: assessment.rpl?.challengeExam?.score,
      practicalDemoPassed: assessment.rpl?.practicalDemo?.overallResult === 'pass',
      externalModerationEndorsed: assessment.rpl?.externalModeration?.decision === 'endorsed',
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #30: Check re-assessment eligibility
// ------------------------------------------------------------------
router.get('/:id/reassessment-eligibility', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.gapTraining rpl.challengeExam rpl.stageCompleted rpl.reassessment status type');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Re-assessment only applies to RPL assessments' });

    // Check if gap training is enrolled/completed
    const gapTraining = assessment.rpl?.gapTraining || [];
    const enrolledCount = gapTraining.filter(g => g.enrolled).length;

    // Eligible if: assessment was rejected/needs-revision AND has gap training recommendations
    const eligible = ['rejected', 'needs-revision'].includes(assessment.status) && gapTraining.length > 0 && enrolledCount > 0;

    // Find gap areas
    const gapAreas = gapTraining.map(g => g.competencyArea);

    // Check for existing reassessment
    const existingReassessment = assessment.rpl?.reassessment;

    res.json({
      eligible,
      reason: !eligible
        ? (gapTraining.length === 0 ? 'No gap training recommended' : enrolledCount === 0 ? 'Must enroll in gap training first' : 'Assessment must be rejected or needs-revision')
        : 'Eligible for re-assessment after gap training',
      gapAreas,
      gapTrainingTotal: gapTraining.length,
      gapTrainingEnrolled: enrolledCount,
      existingReassessment: existingReassessment || null,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #30: Request re-assessment after gap training
// ------------------------------------------------------------------
router.post('/:id/request-reassessment', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('reason').optional().trim().isLength({ max: 1000 }),
  handleValidation,
], auditLog('RPL_REASSESSMENT_REQUEST'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Re-assessment only applies to RPL assessments' });

    // Ownership check
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    // Must be rejected or needs-revision
    if (!['rejected', 'needs-revision'].includes(assessment.status)) {
      return res.status(400).json({ error: 'Only rejected or needs-revision assessments can be re-assessed' });
    }

    // Must have gap training enrolled
    const gapTraining = assessment.rpl?.gapTraining || [];
    const enrolledCount = gapTraining.filter(g => g.enrolled).length;
    if (enrolledCount === 0) {
      return res.status(400).json({ error: 'Must enroll in gap training before requesting re-assessment' });
    }

    // Check if reassessment already requested
    if (assessment.rpl?.reassessment?.status === 'requested' || assessment.rpl?.reassessment?.status === 'approved') {
      return res.status(409).json({ error: 'Re-assessment already requested/approved' });
    }

    const gapAreas = gapTraining.map(g => g.competencyArea);
    const reassessmentNumber = (assessment.rpl?.reassessment?.reassessmentNumber || 0) + 1;

    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.reassessment = {
      parentAssessment: assessment._id,
      reassessmentNumber,
      reason: req.body.reason || 'Completed gap training, requesting re-assessment',
      gapAreasToReassess: gapAreas,
      requestedAt: new Date(),
      requestedBy: req.user._id,
      status: 'requested',
    };
    await assessment.save();

    // Notify assessor
    createRPLNotification({
      recipientUserId: assessment.assessor,
      stage: 'pre-screening',
      assessment,
      details: `Worker has requested re-assessment after gap training. ${gapAreas.length} areas to re-assess.`,
    }).catch(() => {});

    res.json({
      message: 'Re-assessment requested successfully',
      reassessment: assessment.rpl.reassessment,
    });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------------
// Gap #30: Approve re-assessment request (creates new assessment)
// ------------------------------------------------------------------
router.put('/:id/approve-reassessment', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], auditLog('RPL_REASSESSMENT_APPROVE'), async (req, res, next) => {
  try {
    const originalAssessment = await Assessment.findById(req.params.id);
    if (!originalAssessment) return res.status(404).json({ error: 'Assessment not found' });

    const reassessment = originalAssessment.rpl?.reassessment;
    if (!reassessment || reassessment.status !== 'requested') {
      return res.status(400).json({ error: 'No pending re-assessment request found' });
    }

    // Approve the request
    originalAssessment.rpl.reassessment.status = 'approved';
    originalAssessment.rpl.reassessment.approvedAt = new Date();
    originalAssessment.rpl.reassessment.approvedBy = req.user._id;
    await originalAssessment.save();

    // Create new assessment linked to original
    const newAssessmentData = {
      worker: originalAssessment.worker,
      assessor: originalAssessment.assessor,
      type: 'rpl',
      trade: originalAssessment.trade,
      title: `${originalAssessment.title} — Re-assessment #${reassessment.reassessmentNumber}`,
      rpl: {
        stageCompleted: {
          preScreening: true,       // Carry over pre-screening
          evidenceSubmission: true,  // Evidence already submitted
          documentReview: true,      // Documents already reviewed
          interview: false,
          practicalDemo: false,
          challengeExam: false,
          finalDecision: false,
        },
        reassessment: {
          parentAssessment: originalAssessment._id,
          reassessmentNumber: reassessment.reassessmentNumber,
          gapAreasToReassess: reassessment.gapAreasToReassess,
          requestedAt: reassessment.requestedAt,
          requestedBy: reassessment.requestedBy,
          approvedAt: new Date(),
          approvedBy: req.user._id,
          status: 'in-progress',
        },
        // Copy pre-screening results from original
        preScreening: originalAssessment.rpl?.preScreening,
      },
    };

    const newAssessment = await Assessment.create(newAssessmentData);

    // Notify worker
    const worker = await Worker.findById(originalAssessment.worker).populate('user', 'email');
    if (worker?.user) {
      createRPLNotification({
        recipientUserId: worker.user._id || worker.user,
        stage: 'assessor-assigned',
        assessment: newAssessment,
        worker,
        details: `Your re-assessment has been approved. A new assessment has been created for gap areas: ${reassessment.gapAreasToReassess.join(', ')}.`,
      }).catch(() => {});
    }

    res.json({
      message: 'Re-assessment approved',
      newAssessmentId: newAssessment._id,
      gapAreas: reassessment.gapAreasToReassess,
      reassessmentNumber: reassessment.reassessmentNumber,
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #11: Peer/Employer Witness Testimony
// ====================================================================

// POST /:id/witness-testimony — Submit a witness testimony
router.post('/:id/witness-testimony', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('witnessName').trim().notEmpty().isLength({ max: 200 }),
  body('witnessRole').isIn(['peer', 'employer', 'supervisor', 'client']),
  body('testimony').trim().notEmpty().isLength({ max: 3000 }),
  body('organization').optional().trim().isLength({ max: 300 }),
  body('contactEmail').optional().isEmail().normalizeEmail(),
  body('contactPhone').optional().trim().isLength({ max: 20 }),
  body('relationship').optional().trim().isLength({ max: 200 }),
  body('competencyAreas').optional().isArray(),
  body('yearsKnown').optional().isFloat({ min: 0 }).toFloat(),
  body('isGulfEmployer').optional().isBoolean().toBoolean(),
  body('gulfCountry').optional().trim(),
  handleValidation,
], auditLog('RPL_WITNESS_TESTIMONY_SUBMIT'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Witness testimony only applies to RPL assessments' });

    // Workers can add testimonies to their own assessment, assessors/admins to any
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    if (!assessment.rpl) assessment.rpl = {};
    if (!assessment.rpl.witnessTestimonies) assessment.rpl.witnessTestimonies = [];

    // Max 10 testimonies per assessment
    if (assessment.rpl.witnessTestimonies.length >= 10) {
      return res.status(400).json({ error: 'Maximum 10 witness testimonies per assessment' });
    }

    const testimony = {
      witnessName: req.body.witnessName,
      witnessRole: req.body.witnessRole,
      organization: req.body.organization,
      contactEmail: req.body.contactEmail,
      contactPhone: req.body.contactPhone,
      relationship: req.body.relationship,
      competencyAreas: req.body.competencyAreas || [],
      testimony: req.body.testimony,
      yearsKnown: req.body.yearsKnown,
      submittedAt: new Date(),
      submittedBy: req.user._id,
      verified: false,
      isGulfEmployer: req.body.isGulfEmployer || false,
      gulfCountry: req.body.gulfCountry,
    };

    assessment.rpl.witnessTestimonies.push(testimony);
    await assessment.save();

    const added = assessment.rpl.witnessTestimonies[assessment.rpl.witnessTestimonies.length - 1];
    res.status(201).json({
      message: 'Witness testimony submitted',
      testimony: added,
      totalTestimonies: assessment.rpl.witnessTestimonies.length,
    });
  } catch (err) { next(err); }
});

// GET /:id/witness-testimonies — Get all witness testimonies for an assessment
router.get('/:id/witness-testimonies', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.witnessTestimonies type worker');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    // Ownership check for workers
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    const testimonies = assessment.rpl?.witnessTestimonies || [];
    const verified = testimonies.filter(t => t.verified).length;

    res.json({
      total: testimonies.length,
      verified,
      unverified: testimonies.length - verified,
      testimonies,
    });
  } catch (err) { next(err); }
});

// PUT /:id/witness-testimony/:testimonyId/verify — Verify a witness testimony
router.put('/:id/witness-testimony/:testimonyId/verify', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  param('testimonyId').isMongoId().withMessage('Invalid testimony ID'),
  body('verificationMethod').isIn(['phone', 'email', 'in-person', 'document']),
  body('verificationNotes').optional().trim().isLength({ max: 500 }),
  handleValidation,
], auditLog('RPL_WITNESS_TESTIMONY_VERIFY'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const testimony = assessment.rpl?.witnessTestimonies?.id(req.params.testimonyId);
    if (!testimony) return res.status(404).json({ error: 'Testimony not found' });

    testimony.verified = true;
    testimony.verifiedAt = new Date();
    testimony.verifiedBy = req.user._id;
    testimony.verificationMethod = req.body.verificationMethod;
    testimony.verificationNotes = req.body.verificationNotes;

    await assessment.save();

    res.json({ message: 'Testimony verified', testimony });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #27: Gulf Employer Verification Portal
// ====================================================================

// POST /:id/employer-verification/request — Request employer verification
router.post('/:id/employer-verification/request', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('employerName').trim().notEmpty().isLength({ max: 300 }),
  body('employerCountry').trim().notEmpty().isLength({ max: 100 }),
  body('employerEmail').isEmail().normalizeEmail(),
  handleValidation,
], auditLog('RPL_EMPLOYER_VERIFICATION_REQUEST'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Employer verification only applies to RPL assessments' });

    if (!assessment.rpl) assessment.rpl = {};

    // Generate verification code
    const verificationCode = crypto.randomBytes(16).toString('hex');

    assessment.rpl.employerVerification = {
      requested: true,
      requestedAt: new Date(),
      employerName: req.body.employerName,
      employerCountry: req.body.employerCountry,
      employerEmail: req.body.employerEmail,
      verificationStatus: 'pending',
      verificationCode,
    };

    await assessment.save();

    res.json({
      message: 'Employer verification request submitted',
      verificationStatus: 'pending',
      employerName: req.body.employerName,
      employerCountry: req.body.employerCountry,
    });
  } catch (err) { next(err); }
});

// GET /:id/employer-verification — Get employer verification status
router.get('/:id/employer-verification', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.employerVerification type worker');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    // Ownership check for workers
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    const ev = assessment.rpl?.employerVerification || {};
    res.json({
      requested: ev.requested || false,
      verificationStatus: ev.verificationStatus || 'none',
      employerName: ev.employerName,
      employerCountry: ev.employerCountry,
      requestedAt: ev.requestedAt,
      verifiedAt: ev.verifiedAt,
      notes: ev.notes,
    });
  } catch (err) { next(err); }
});

// PUT /:id/employer-verification/verify — Complete employer verification (employer/admin/institution)
router.put('/:id/employer-verification/verify', authenticate, authorize('admin', 'employer', 'institution'), [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('decision').isIn(['verified', 'rejected']),
  body('notes').optional().trim().isLength({ max: 1000 }),
  body('verificationCode').optional().trim(),
  handleValidation,
], auditLog('RPL_EMPLOYER_VERIFICATION_COMPLETE'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const ev = assessment.rpl?.employerVerification;
    if (!ev?.requested) {
      return res.status(400).json({ error: 'No employer verification request found' });
    }
    if (ev.verificationStatus !== 'pending') {
      return res.status(409).json({ error: `Verification already ${ev.verificationStatus}` });
    }

    assessment.rpl.employerVerification.verificationStatus = req.body.decision;
    assessment.rpl.employerVerification.verifiedAt = new Date();
    assessment.rpl.employerVerification.verifiedBy = req.user._id;
    assessment.rpl.employerVerification.notes = req.body.notes;

    await assessment.save();

    // If verified, link to witness testimonies from this employer
    if (req.body.decision === 'verified' && assessment.rpl.witnessTestimonies) {
      for (const t of assessment.rpl.witnessTestimonies) {
        if (t.isGulfEmployer && t.organization === ev.employerName && !t.verified) {
          t.verified = true;
          t.verifiedAt = new Date();
          t.verifiedBy = req.user._id;
          t.verificationMethod = 'document';
          t.employerVerificationId = assessment._id.toString();
        }
      }
      await assessment.save();
    }

    res.json({
      message: `Employer verification ${req.body.decision}`,
      verificationStatus: req.body.decision,
    });
  } catch (err) { next(err); }
});

// GET /employer-verification/queue — List all pending employer verifications (employer portal)
router.get('/employer-verification/queue', authenticate, authorize('admin', 'employer', 'institution'), async (req, res, next) => {
  try {
    const assessments = await Assessment.find({
      type: 'rpl',
      'rpl.employerVerification.requested': true,
      'rpl.employerVerification.verificationStatus': 'pending',
    }).select('trade title rpl.employerVerification worker createdAt').populate('worker', 'fullName trade district');

    const queue = assessments.map(a => ({
      assessmentId: a._id,
      trade: a.trade,
      title: a.title,
      worker: a.worker ? { name: a.worker.fullName, trade: a.worker.trade, district: a.worker.district } : null,
      employer: {
        name: a.rpl.employerVerification.employerName,
        country: a.rpl.employerVerification.employerCountry,
        email: a.rpl.employerVerification.employerEmail,
      },
      requestedAt: a.rpl.employerVerification.requestedAt,
    }));

    res.json({ total: queue.length, queue });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #26: Multilingual RPL Forms (Arabic / Urdu / English)
// ====================================================================

// Static translation dictionaries for RPL forms
const RPL_TRANSLATIONS = {
  en: {
    formTitle: 'RPL Assessment Application Form',
    preScreeningTitle: 'Pre-Screening Self-Assessment',
    consentTitle: 'Candidate Consent Form',
    evidenceTitle: 'Evidence Submission Checklist',
    interviewTitle: 'Competency-Based Interview Record',
    practicalTitle: 'Practical Demonstration Assessment',
    labels: {
      fullName: 'Full Name',
      trade: 'Trade / Occupation',
      dateOfBirth: 'Date of Birth',
      cnic: 'CNIC Number',
      district: 'District',
      phone: 'Phone Number',
      yearsExperience: 'Years of Experience',
      employer: 'Current/Last Employer',
      declaration: 'I declare that the information provided is true and accurate to the best of my knowledge.',
      consent: 'I consent to my evidence being used for assessment purposes and understand my data rights.',
      signature: 'Signature',
      date: 'Date',
      assessorName: 'Assessor Name',
      assessorSignature: 'Assessor Signature',
      result: 'Result',
      pass: 'Pass',
      fail: 'Fail',
      pending: 'Pending',
      competencyArea: 'Competency Area',
      score: 'Score',
      notes: 'Notes / Observations',
      witnessName: 'Witness Name',
      witnessRelation: 'Relationship to Candidate',
    },
    stages: {
      preScreening: 'Pre-Screening',
      evidenceSubmission: 'Evidence Submission',
      documentReview: 'Document Review',
      interview: 'Interview',
      practicalDemo: 'Practical Demonstration',
      challengeExam: 'Knowledge Test',
      moderation: 'Moderation',
      finalDecision: 'Final Decision',
    },
    instructions: {
      preScreening: 'Please rate your experience in each competency area on a scale of 1-5.',
      evidence: 'Gather and submit all relevant documents including experience letters, trade certificates, and references.',
      consent: 'Please read each consent item carefully and indicate your agreement by checking each box.',
      interview: 'The assessor will ask competency-based questions. Answer based on your real work experience.',
      practical: 'You will be asked to demonstrate key trade skills under observation.',
    },
  },
  ur: {
    formTitle: 'آر پی ایل تشخیص درخواست فارم',
    preScreeningTitle: 'پری اسکریننگ خود تشخیص',
    consentTitle: 'امیدوار رضامندی فارم',
    evidenceTitle: 'ثبوت جمع کرانے کی فہرست',
    interviewTitle: 'قابلیت پر مبنی انٹرویو ریکارڈ',
    practicalTitle: 'عملی مظاہرے کی تشخیص',
    labels: {
      fullName: 'پورا نام',
      trade: 'پیشہ / ہنر',
      dateOfBirth: 'تاریخ پیدائش',
      cnic: 'شناختی کارڈ نمبر',
      district: 'ضلع',
      phone: 'فون نمبر',
      yearsExperience: 'تجربے کے سال',
      employer: 'موجودہ / آخری آجر',
      declaration: 'میں اعلان کرتا/کرتی ہوں کہ فراہم کردہ معلومات میری بہترین معلومات کے مطابق درست ہیں۔',
      consent: 'میں اپنے ثبوت کو تشخیص کے مقاصد کے لیے استعمال کرنے پر رضامند ہوں اور اپنے ڈیٹا کے حقوق سمجھتا/سمجھتی ہوں۔',
      signature: 'دستخط',
      date: 'تاریخ',
      assessorName: 'تشخیص کار کا نام',
      assessorSignature: 'تشخیص کار کے دستخط',
      result: 'نتیجہ',
      pass: 'کامیاب',
      fail: 'ناکام',
      pending: 'زیر غور',
      competencyArea: 'قابلیت کا شعبہ',
      score: 'اسکور',
      notes: 'نوٹس / مشاہدات',
      witnessName: 'گواہ کا نام',
      witnessRelation: 'امیدوار سے تعلق',
    },
    stages: {
      preScreening: 'پری اسکریننگ',
      evidenceSubmission: 'ثبوت جمع کرانا',
      documentReview: 'دستاویزات کا جائزہ',
      interview: 'انٹرویو',
      practicalDemo: 'عملی مظاہرہ',
      challengeExam: 'علمی امتحان',
      moderation: 'اعتدال',
      finalDecision: 'حتمی فیصلہ',
    },
    instructions: {
      preScreening: 'براہ کرم ہر قابلیت کے شعبے میں اپنے تجربے کی درجہ بندی ۱ سے ۵ کے پیمانے پر کریں۔',
      evidence: 'تمام متعلقہ دستاویزات جمع کر کے جمع کرائیں بشمول تجربہ خطوط، ہنر سرٹیفکیٹ، اور حوالہ جات۔',
      consent: 'براہ کرم ہر رضامندی کی شق کو غور سے پڑھیں اور ہر خانے پر نشان لگا کر اپنی رضامندی ظاہر کریں۔',
      interview: 'تشخیص کار قابلیت پر مبنی سوالات پوچھے گا۔ اپنے حقیقی کام کے تجربے کی بنیاد پر جواب دیں۔',
      practical: 'آپ سے نگرانی میں اہم ہنر مندی کا مظاہرہ کرنے کو کہا جائے گا۔',
    },
  },
  ar: {
    formTitle: 'نموذج طلب تقييم الاعتراف بالتعلم المسبق',
    preScreeningTitle: 'التقييم الذاتي الأولي',
    consentTitle: 'نموذج موافقة المرشح',
    evidenceTitle: 'قائمة تقديم الأدلة',
    interviewTitle: 'سجل المقابلة القائمة على الكفاءة',
    practicalTitle: 'تقييم العرض العملي',
    labels: {
      fullName: 'الاسم الكامل',
      trade: 'المهنة / الحرفة',
      dateOfBirth: 'تاريخ الميلاد',
      cnic: 'رقم الهوية الوطنية',
      district: 'المنطقة',
      phone: 'رقم الهاتف',
      yearsExperience: 'سنوات الخبرة',
      employer: 'صاحب العمل الحالي / الأخير',
      declaration: 'أقر بأن المعلومات المقدمة صحيحة ودقيقة على حد علمي.',
      consent: 'أوافق على استخدام أدلتي لأغراض التقييم وأفهم حقوقي في البيانات.',
      signature: 'التوقيع',
      date: 'التاريخ',
      assessorName: 'اسم المقيّم',
      assessorSignature: 'توقيع المقيّم',
      result: 'النتيجة',
      pass: 'ناجح',
      fail: 'راسب',
      pending: 'قيد الانتظار',
      competencyArea: 'مجال الكفاءة',
      score: 'الدرجة',
      notes: 'ملاحظات',
      witnessName: 'اسم الشاهد',
      witnessRelation: 'العلاقة بالمرشح',
    },
    stages: {
      preScreening: 'الفحص الأولي',
      evidenceSubmission: 'تقديم الأدلة',
      documentReview: 'مراجعة الوثائق',
      interview: 'المقابلة',
      practicalDemo: 'العرض العملي',
      challengeExam: 'اختبار المعرفة',
      moderation: 'المراجعة',
      finalDecision: 'القرار النهائي',
    },
    instructions: {
      preScreening: 'يرجى تقييم خبرتك في كل مجال كفاءة على مقياس من ١ إلى ٥.',
      evidence: 'اجمع وقدم جميع الوثائق ذات الصلة بما في ذلك خطابات الخبرة وشهادات المهنة والمراجع.',
      consent: 'يرجى قراءة كل بند من بنود الموافقة بعناية والإشارة إلى موافقتك بتحديد كل خانة.',
      interview: 'سيطرح المقيّم أسئلة قائمة على الكفاءة. أجب بناءً على خبرتك العملية الفعلية.',
      practical: 'سيُطلب منك إظهار مهارات المهنة الأساسية تحت الملاحظة.',
    },
  },
};

// GET /multilingual/forms/:lang — Get all RPL form translations for a language
router.get('/multilingual/forms/:lang', authenticate, [
  param('lang').isIn(['en', 'ur', 'ar']).withMessage('Supported languages: en, ur, ar'),
  handleValidation,
], async (req, res, next) => {
  try {
    const lang = req.params.lang;
    const translations = RPL_TRANSLATIONS[lang];
    if (!translations) return res.status(404).json({ error: 'Language not found' });

    res.json({
      language: lang,
      direction: lang === 'ar' || lang === 'ur' ? 'rtl' : 'ltr',
      translations,
    });
  } catch (err) { next(err); }
});

// GET /multilingual/forms — Get all available languages
router.get('/multilingual/forms', authenticate, async (req, res, next) => {
  try {
    res.json({
      languages: [
        { code: 'en', name: 'English', direction: 'ltr', native: 'English' },
        { code: 'ur', name: 'Urdu', direction: 'rtl', native: 'اردو' },
        { code: 'ar', name: 'Arabic', direction: 'rtl', native: 'العربية' },
      ],
      defaultLanguage: 'en',
    });
  } catch (err) { next(err); }
});

// PUT /:id/language — Set assessment language preference
router.put('/:id/language', authenticate, [
  param('id').isMongoId().withMessage('Invalid assessment ID'),
  body('language').isIn(['en', 'ur', 'ar']).withMessage('Supported languages: en, ur, ar'),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Language setting only applies to RPL assessments' });

    // Ownership check for workers
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.language = req.body.language;
    await assessment.save();

    res.json({
      message: `Assessment language set to ${req.body.language}`,
      language: req.body.language,
      direction: req.body.language === 'ar' || req.body.language === 'ur' ? 'rtl' : 'ltr',
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #8: Workplace Observation
// ====================================================================

// PUT /:id/workplace-observation — Record workplace observation
router.put('/:id/workplace-observation', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('id').isMongoId(),
  body('site').trim().notEmpty().isLength({ max: 300 }),
  body('rubric').isArray({ min: 1 }),
  body('overallResult').isIn(['pass', 'fail', 'pending']),
  handleValidation,
], auditLog('RPL_WORKPLACE_OBSERVATION'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Workplace observation only applies to RPL assessments' });

    if (!assessment.rpl) assessment.rpl = {};

    const rubric = req.body.rubric.map(r => ({
      criterion: r.criterion,
      description: r.description,
      score: r.score,
      notes: r.notes,
    }));
    const totalScore = rubric.length > 0
      ? Math.round(rubric.reduce((s, r) => s + (r.score || 0), 0) / (rubric.length * 4) * 100)
      : 0;

    assessment.rpl.workplaceObservation = {
      conductedDate: new Date(),
      site: req.body.site,
      siteAddress: req.body.siteAddress,
      supervisorName: req.body.supervisorName,
      supervisorContact: req.body.supervisorContact,
      durationMinutes: req.body.durationMinutes,
      tasksObserved: req.body.tasksObserved || [],
      rubric,
      overallResult: req.body.overallResult,
      totalScore,
      safetyCompliance: req.body.safetyCompliance,
      environmentalConditions: req.body.environmentalConditions,
      assessorNotes: req.body.assessorNotes,
    };
    if (req.body.scheduledDate) assessment.rpl.workplaceObservation.scheduledDate = new Date(req.body.scheduledDate);

    assessment.rpl.stageCompleted.workplaceObservation = req.body.overallResult === 'pass';
    await assessment.save();

    res.json({
      message: `Workplace observation recorded: ${req.body.overallResult}`,
      workplaceObservation: assessment.rpl.workplaceObservation,
    });
  } catch (err) { next(err); }
});

// GET /:id/workplace-observation — Get workplace observation details
router.get('/:id/workplace-observation', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.workplaceObservation rpl.stageCompleted.workplaceObservation type');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    res.json({
      completed: assessment.rpl?.stageCompleted?.workplaceObservation || false,
      observation: assessment.rpl?.workplaceObservation || null,
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #24: Pre-departure RPL Assessment
// ====================================================================

// PUT /:id/pre-departure — Submit/update pre-departure assessment
router.put('/:id/pre-departure', authenticate, [
  param('id').isMongoId(),
  body('targetCountry').trim().notEmpty().isLength({ max: 100 }),
  body('checklist').isObject(),
  handleValidation,
], auditLog('RPL_PRE_DEPARTURE_ASSESSMENT'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Pre-departure only applies to RPL assessments' });

    // Ownership check
    if (req.user.role === 'worker') {
      const ownWorker = await Worker.findOne({ user: req.user._id }).select('_id');
      if (!ownWorker || assessment.worker.toString() !== ownWorker._id.toString()) {
        return res.status(403).json({ error: 'Access denied: not your assessment' });
      }
    }

    if (!assessment.rpl) assessment.rpl = {};
    const cl = req.body.checklist;

    // Calculate readiness score
    const checks = [
      cl.passportValid, cl.visaObtained, cl.medicalClearance, cl.tradeTestPassed,
      cl.safetyTrainingCompleted, cl.culturalOrientationDone, cl.contractReviewed,
      cl.insuranceCoverage, cl.emergencyContactProvided, cl.beoeBriefingCompleted,
      cl.financialLiteracyTraining,
    ];
    const langScore = cl.languageProficiency === 'advanced' ? 1 : cl.languageProficiency === 'intermediate' ? 0.7 : cl.languageProficiency === 'basic' ? 0.4 : 0;
    const boolScore = checks.filter(Boolean).length;
    const readinessScore = Math.round(((boolScore + langScore) / 12) * 100);

    // Identify blockers
    const blockers = [];
    if (!cl.passportValid) blockers.push('Passport not valid');
    if (!cl.visaObtained) blockers.push('Visa not obtained');
    if (!cl.medicalClearance) blockers.push('Medical clearance pending');
    if (!cl.tradeTestPassed) blockers.push('Trade test not passed');
    if (!cl.safetyTrainingCompleted) blockers.push('Safety training incomplete');
    if (!cl.beoeBriefingCompleted) blockers.push('BEOE briefing not completed');

    assessment.rpl.preDepartureAssessment = {
      targetCountry: req.body.targetCountry,
      departureDate: req.body.departureDate ? new Date(req.body.departureDate) : undefined,
      checklist: cl,
      readinessScore,
      ready: readinessScore >= 80 && blockers.length === 0,
      blockers,
      notes: req.body.notes,
      completedDate: new Date(),
    };
    await assessment.save();

    res.json({
      message: readinessScore >= 80 && blockers.length === 0 ? 'Worker is departure-ready' : 'Pre-departure assessment updated',
      preDepartureAssessment: assessment.rpl.preDepartureAssessment,
    });
  } catch (err) { next(err); }
});

// GET /:id/pre-departure — Get pre-departure assessment status
router.get('/:id/pre-departure', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.preDepartureAssessment type');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    res.json(assessment.rpl?.preDepartureAssessment || { ready: false, readinessScore: 0 });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #31: RPL Scheduling / Booking
// ====================================================================

// POST /:id/schedule — Add a schedule slot
router.post('/:id/schedule', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('id').isMongoId(),
  body('stage').isIn(['pre-screening', 'challenge-exam', 'interview', 'practical-demo', 'workplace-observation', 'document-review']),
  body('scheduledDate').isISO8601(),
  body('venue').trim().notEmpty().isLength({ max: 300 }),
  body('venueId').optional().isMongoId(),
  handleValidation,
], auditLog('RPL_SCHEDULE_ADD'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Scheduling only applies to RPL assessments' });

    if (!assessment.rpl) assessment.rpl = {};
    if (!assessment.rpl.schedule) assessment.rpl.schedule = [];

    const slot = {
      stage: req.body.stage,
      scheduledDate: new Date(req.body.scheduledDate),
      scheduledEndDate: req.body.scheduledEndDate ? new Date(req.body.scheduledEndDate) : undefined,
      venue: req.body.venue,
      venueAddress: req.body.venueAddress,
      assessor: req.body.assessorId || req.user._id,
      status: 'scheduled',
      notes: req.body.notes,
    };

    // Gap #34: Auto-populate venue details from Venue model
    if (req.body.venueId) {
      const venueDoc = await Venue.findById(req.body.venueId);
      if (venueDoc) {
        slot.venueId = venueDoc._id;
        slot.venue = venueDoc.name;
        slot.venueAddress = venueDoc.address;
      }
    }

    assessment.rpl.schedule.push(slot);
    await assessment.save();

    const added = assessment.rpl.schedule[assessment.rpl.schedule.length - 1];

    // Notify worker
    createRPLNotification({
      recipientUserId: assessment.worker,
      stage: 'pre-screening',
      assessment,
      details: `Assessment ${req.body.stage} scheduled for ${new Date(req.body.scheduledDate).toLocaleDateString()} at ${req.body.venue}`,
    }).catch(() => {});

    res.status(201).json({ message: 'Schedule slot added', slot: added });
  } catch (err) { next(err); }
});

// GET /:id/schedule — Get assessment schedule
router.get('/:id/schedule', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.schedule type');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const schedule = (assessment.rpl?.schedule || []).sort((a, b) =>
      new Date(a.scheduledDate) - new Date(b.scheduledDate)
    );

    res.json({
      total: schedule.length,
      upcoming: schedule.filter(s => s.status === 'scheduled' && new Date(s.scheduledDate) >= new Date()).length,
      schedule,
    });
  } catch (err) { next(err); }
});

// PUT /:id/schedule/:slotId — Update a schedule slot (confirm/cancel/reschedule)
router.put('/:id/schedule/:slotId', authenticate, [
  param('id').isMongoId(),
  param('slotId').isMongoId(),
  body('status').isIn(['confirmed', 'completed', 'cancelled', 'rescheduled']),
  handleValidation,
], auditLog('RPL_SCHEDULE_UPDATE'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const slot = assessment.rpl?.schedule?.id(req.params.slotId);
    if (!slot) return res.status(404).json({ error: 'Schedule slot not found' });

    slot.status = req.body.status;
    if (req.body.status === 'confirmed') slot.confirmedAt = new Date();
    if (req.body.status === 'cancelled') slot.cancelledReason = req.body.reason;
    if (req.body.status === 'rescheduled' && req.body.newDate) {
      slot.scheduledDate = new Date(req.body.newDate);
      slot.status = 'scheduled';
    }
    if (req.body.notes) slot.notes = req.body.notes;

    await assessment.save();
    res.json({ message: `Schedule slot ${req.body.status}`, slot });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #25: MRA (Mutual Recognition Agreement) Support
// ====================================================================

const MRA_FRAMEWORKS = {
  'Pakistan-UAE': {
    sourceCountry: 'Pakistan', sourceFramework: 'NAVTTC/NQF',
    targetCountry: 'UAE', targetFramework: 'UAE NQF/MOHRE',
    mappings: [
      { sourceLevel: 'NQF-1', targetLevel: 'MOHRE-Semi-Skilled', equivalency: 'full' },
      { sourceLevel: 'NQF-2', targetLevel: 'MOHRE-Skilled', equivalency: 'full' },
      { sourceLevel: 'NQF-3', targetLevel: 'MOHRE-Skilled', equivalency: 'full' },
      { sourceLevel: 'NQF-4', targetLevel: 'MOHRE-Technician', equivalency: 'conditional', conditions: 'UAE trade test required' },
      { sourceLevel: 'NQF-5', targetLevel: 'MOHRE-Senior-Technician', equivalency: 'conditional', conditions: 'UAE equivalency assessment required' },
    ],
  },
  'Pakistan-KSA': {
    sourceCountry: 'Pakistan', sourceFramework: 'NAVTTC/NQF',
    targetCountry: 'Saudi Arabia', targetFramework: 'Saudi SVP/TVTC',
    mappings: [
      { sourceLevel: 'NQF-1', targetLevel: 'SVP-Level-1', equivalency: 'full' },
      { sourceLevel: 'NQF-2', targetLevel: 'SVP-Level-2', equivalency: 'full' },
      { sourceLevel: 'NQF-3', targetLevel: 'SVP-Level-3', equivalency: 'partial', conditions: 'Additional Saudi certification may be required' },
      { sourceLevel: 'NQF-4', targetLevel: 'SVP-Level-4', equivalency: 'conditional', conditions: 'Saudi skills verification program assessment' },
    ],
  },
  'Pakistan-Qatar': {
    sourceCountry: 'Pakistan', sourceFramework: 'NAVTTC/NQF',
    targetCountry: 'Qatar', targetFramework: 'Qatar NQF',
    mappings: [
      { sourceLevel: 'NQF-1', targetLevel: 'QNQF-1', equivalency: 'full' },
      { sourceLevel: 'NQF-2', targetLevel: 'QNQF-2', equivalency: 'full' },
      { sourceLevel: 'NQF-3', targetLevel: 'QNQF-3', equivalency: 'partial', conditions: 'Ashghal certification for construction trades' },
    ],
  },
  'Pakistan-Oman': {
    sourceCountry: 'Pakistan', sourceFramework: 'NAVTTC/NQF',
    targetCountry: 'Oman', targetFramework: 'Oman NQF',
    mappings: [
      { sourceLevel: 'NQF-1', targetLevel: 'ONF-1', equivalency: 'full' },
      { sourceLevel: 'NQF-2', targetLevel: 'ONF-2', equivalency: 'full' },
      { sourceLevel: 'NQF-3', targetLevel: 'ONF-3', equivalency: 'conditional', conditions: 'Oman manpower ministry validation' },
    ],
  },
};

// GET /mra/frameworks — List all MRA frameworks
router.get('/mra/frameworks', authenticate, async (req, res, next) => {
  try {
    const frameworks = Object.entries(MRA_FRAMEWORKS).map(([key, fw]) => ({
      key,
      sourceCountry: fw.sourceCountry,
      sourceFramework: fw.sourceFramework,
      targetCountry: fw.targetCountry,
      targetFramework: fw.targetFramework,
      levelMappings: fw.mappings.length,
    }));
    res.json({ total: frameworks.length, frameworks });
  } catch (err) { next(err); }
});

// GET /mra/lookup/:corridor/:level — Look up equivalency for a specific level
router.get('/mra/lookup/:corridor/:level', authenticate, [
  param('corridor').trim().notEmpty(),
  param('level').trim().notEmpty(),
  handleValidation,
], async (req, res, next) => {
  try {
    const fw = MRA_FRAMEWORKS[req.params.corridor];
    if (!fw) return res.status(404).json({ error: 'MRA corridor not found', available: Object.keys(MRA_FRAMEWORKS) });

    const mapping = fw.mappings.find(m => m.sourceLevel === req.params.level);
    if (!mapping) return res.status(404).json({ error: `Level ${req.params.level} not found in ${req.params.corridor}` });

    res.json({
      corridor: req.params.corridor,
      sourceCountry: fw.sourceCountry,
      sourceFramework: fw.sourceFramework,
      sourceLevel: mapping.sourceLevel,
      targetCountry: fw.targetCountry,
      targetFramework: fw.targetFramework,
      targetLevel: mapping.targetLevel,
      equivalency: mapping.equivalency,
      conditions: mapping.conditions || null,
    });
  } catch (err) { next(err); }
});

// PUT /:id/mra — Apply MRA mapping to an assessment
router.put('/:id/mra', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('id').isMongoId(),
  body('corridor').trim().notEmpty(),
  body('sourceLevel').trim().notEmpty(),
  handleValidation,
], auditLog('RPL_MRA_APPLY'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'MRA only applies to RPL assessments' });

    const fw = MRA_FRAMEWORKS[req.body.corridor];
    if (!fw) return res.status(404).json({ error: 'MRA corridor not found' });

    const mapping = fw.mappings.find(m => m.sourceLevel === req.body.sourceLevel);
    if (!mapping) return res.status(404).json({ error: 'Level mapping not found' });

    if (!assessment.rpl) assessment.rpl = {};
    if (!assessment.rpl.mraMapping) assessment.rpl.mraMapping = [];

    // Avoid duplicates
    const exists = assessment.rpl.mraMapping.find(m =>
      m.sourceCountry === fw.sourceCountry && m.targetCountry === fw.targetCountry && m.sourceLevel === mapping.sourceLevel
    );
    if (exists) return res.status(409).json({ error: 'MRA mapping already applied for this corridor/level' });

    assessment.rpl.mraMapping.push({
      sourceCountry: fw.sourceCountry,
      sourceFramework: fw.sourceFramework,
      sourceLevel: mapping.sourceLevel,
      targetCountry: fw.targetCountry,
      targetFramework: fw.targetFramework,
      targetLevel: mapping.targetLevel,
      equivalencyStatus: mapping.equivalency,
      conditions: mapping.conditions,
      verifiedAt: new Date(),
    });
    await assessment.save();

    res.json({
      message: `MRA mapping applied: ${mapping.sourceLevel} -> ${mapping.targetLevel} (${mapping.equivalency})`,
      mapping: assessment.rpl.mraMapping[assessment.rpl.mraMapping.length - 1],
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #20: AI-Assisted Evidence Analysis
// ====================================================================

const TRADE_EVIDENCE_REQUIREMENTS = {
  default: {
    requiredDocuments: ['experience-letter', 'trade-certificate'],
    preferredDocuments: ['reference-letter', 'work-sample'],
    minDocuments: 2,
    minExperienceYears: 1,
    competencyAreas: ['Core Trade Skills', 'Safety & PPE', 'Tools & Equipment'],
  },
  electrician: {
    requiredDocuments: ['experience-letter', 'trade-certificate'],
    preferredDocuments: ['reference-letter', 'work-sample', 'identity-doc'],
    minDocuments: 3,
    minExperienceYears: 2,
    competencyAreas: ['Wiring Installation', 'Circuit Design', 'Safety & Grounding', 'Panel Installation', 'Testing & Measurement', 'Troubleshooting'],
    specificChecks: [
      { check: 'Has electrical safety certification', weight: 15 },
      { check: 'Experience with commercial installations', weight: 10 },
      { check: 'Familiar with IEC/NEC standards', weight: 10 },
    ],
  },
  welder: {
    requiredDocuments: ['experience-letter', 'trade-certificate'],
    preferredDocuments: ['reference-letter', 'work-sample'],
    minDocuments: 3,
    minExperienceYears: 2,
    competencyAreas: ['SMAW', 'MIG/MAG', 'TIG', 'Joint Preparation', 'Blueprint Reading', 'Weld Inspection'],
    specificChecks: [
      { check: 'Has welding certification (AWS/ASME)', weight: 15 },
      { check: 'Pressure vessel or pipeline experience', weight: 10 },
      { check: 'NDT awareness', weight: 5 },
    ],
  },
  mason: {
    requiredDocuments: ['experience-letter', 'trade-certificate'],
    preferredDocuments: ['reference-letter', 'work-sample'],
    minDocuments: 2,
    minExperienceYears: 1,
    competencyAreas: ['Foundation Laying', 'Brick & Block Bonding', 'Plastering', 'Leveling', 'Mortar Mixing', 'Safety'],
    specificChecks: [
      { check: 'Has worked on multi-story structures', weight: 10 },
      { check: 'Familiar with building codes', weight: 10 },
    ],
  },
};

// POST /:id/evidence-analysis — Run AI-assisted evidence analysis
router.post('/:id/evidence-analysis', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('id').isMongoId(),
  handleValidation,
], auditLog('RPL_EVIDENCE_ANALYSIS'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Evidence analysis only applies to RPL assessments' });

    const reqs = TRADE_EVIDENCE_REQUIREMENTS[assessment.trade] || TRADE_EVIDENCE_REQUIREMENTS.default;
    const docs = assessment.rpl?.documentaryEvidence || [];
    const preScreening = assessment.rpl?.preScreening;
    const interview = assessment.rpl?.interview;
    const testimonies = assessment.rpl?.witnessTestimonies || [];

    // --- Completeness Score ---
    let completenessScore = 0;
    const docCategories = docs.map(d => d.category);
    const hasRequired = reqs.requiredDocuments.every(rd => docCategories.includes(rd));
    completenessScore += hasRequired ? 30 : (reqs.requiredDocuments.filter(rd => docCategories.includes(rd)).length / reqs.requiredDocuments.length) * 30;
    completenessScore += Math.min(docs.length / reqs.minDocuments, 1) * 20;
    const hasPreferred = reqs.preferredDocuments.filter(pd => docCategories.includes(pd)).length;
    completenessScore += (hasPreferred / reqs.preferredDocuments.length) * 15;
    if (preScreening?.completed) completenessScore += 10;
    if (interview?.items?.length > 0) completenessScore += 10;
    if (testimonies.length > 0) completenessScore += 5;
    const verifiedTestimonies = testimonies.filter(t => t.verified).length;
    if (verifiedTestimonies > 0) completenessScore += 5;
    completenessScore = Math.min(Math.round(completenessScore), 100);

    // --- Sufficiency Score ---
    let sufficiencyScore = 0;
    const thirdPartyVerified = docs.filter(d => d.verifiedByThirdParty).length;
    sufficiencyScore += Math.min(thirdPartyVerified / Math.max(docs.length, 1), 1) * 30;
    const experienceYears = preScreening?.tradeExperience?.totalYears || 0;
    sufficiencyScore += Math.min(experienceYears / reqs.minExperienceYears, 1) * 25;
    if (preScreening?.eligible) sufficiencyScore += 15;
    const avgInterviewScore = interview?.items?.length > 0
      ? interview.items.reduce((s, i) => s + (i.score || 0), 0) / interview.items.length
      : 0;
    sufficiencyScore += (avgInterviewScore / 4) * 20;
    sufficiencyScore += Math.min(testimonies.length / 2, 1) * 10;
    sufficiencyScore = Math.min(Math.round(sufficiencyScore), 100);

    // --- Authenticity Score ---
    let authenticityScore = 0;
    authenticityScore += thirdPartyVerified > 0 ? 30 : 0;
    authenticityScore += verifiedTestimonies > 0 ? 25 : 0;
    const employerVerified = assessment.rpl?.employerVerification?.verificationStatus === 'verified';
    authenticityScore += employerVerified ? 25 : 0;
    authenticityScore += docs.length >= reqs.minDocuments ? 10 : 0;
    authenticityScore += preScreening?.tradeExperience?.formalTraining ? 10 : 0;
    authenticityScore = Math.min(Math.round(authenticityScore), 100);

    // --- Overall Score ---
    const overallScore = Math.round(completenessScore * 0.35 + sufficiencyScore * 0.40 + authenticityScore * 0.25);

    // --- Gap Identification ---
    const gaps = [];
    if (!hasRequired) {
      const missing = reqs.requiredDocuments.filter(rd => !docCategories.includes(rd));
      gaps.push({ area: 'Required Documents', severity: 'high', recommendation: `Missing: ${missing.join(', ')}` });
    }
    if (docs.length < reqs.minDocuments) {
      gaps.push({ area: 'Document Count', severity: 'medium', recommendation: `Need at least ${reqs.minDocuments} documents, have ${docs.length}` });
    }
    if (thirdPartyVerified === 0) {
      gaps.push({ area: 'Third-party Verification', severity: 'medium', recommendation: 'No documents have third-party verification' });
    }
    if (testimonies.length === 0) {
      gaps.push({ area: 'Witness Testimonies', severity: 'low', recommendation: 'Add peer or employer witness testimonies' });
    }
    if (experienceYears < reqs.minExperienceYears) {
      gaps.push({ area: 'Experience', severity: 'high', recommendation: `Minimum ${reqs.minExperienceYears} years required, reported ${experienceYears}` });
    }

    // --- Strengths ---
    const strengths = [];
    if (hasRequired) strengths.push('All required documents submitted');
    if (thirdPartyVerified > 0) strengths.push(`${thirdPartyVerified} documents have third-party verification`);
    if (verifiedTestimonies > 0) strengths.push(`${verifiedTestimonies} verified witness testimonies`);
    if (employerVerified) strengths.push('Employer verification completed');
    if (experienceYears >= reqs.minExperienceYears) strengths.push(`${experienceYears} years of experience (meets minimum)`);
    if (avgInterviewScore >= 3) strengths.push('Strong interview performance');

    // --- Recommendations ---
    const recommendations = [];
    if (overallScore < 50) recommendations.push('Evidence portfolio needs significant strengthening before proceeding');
    else if (overallScore < 70) recommendations.push('Consider gathering additional supporting documents');
    else recommendations.push('Evidence portfolio is strong — recommend proceeding to next assessment stage');
    if (gaps.some(g => g.severity === 'high')) recommendations.push('Address high-severity gaps before final decision');

    // --- Trade-specific checks ---
    const tradeSpecificChecks = (reqs.specificChecks || []).map(sc => {
      const keywords = sc.check.toLowerCase().split(' ');
      const allText = [
        ...docs.map(d => (d.filename || '').toLowerCase()),
        ...(interview?.items || []).map(i => ((i.response || '') + ' ' + (i.competencyArea || '')).toLowerCase()),
        ...testimonies.map(t => (t.testimony || '').toLowerCase()),
      ].join(' ');
      const matched = keywords.filter(k => k.length > 3 && allText.includes(k)).length;
      return { check: sc.check, passed: matched >= Math.ceil(keywords.filter(k => k.length > 3).length * 0.3), notes: matched > 0 ? 'Evidence found' : 'No direct evidence' };
    });

    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.evidenceAnalysis = {
      analyzed: true,
      analyzedAt: new Date(),
      overallScore,
      completeness: completenessScore,
      sufficiency: sufficiencyScore,
      authenticity: authenticityScore,
      gaps,
      strengths,
      recommendations,
      tradeSpecificChecks,
    };
    await assessment.save();

    res.json({
      message: 'Evidence analysis complete',
      analysis: assessment.rpl.evidenceAnalysis,
    });
  } catch (err) { next(err); }
});

// GET /:id/evidence-analysis — Get evidence analysis results
router.get('/:id/evidence-analysis', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.evidenceAnalysis type');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    res.json(assessment.rpl?.evidenceAnalysis || { analyzed: false });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #18: Blockchain Anchoring (via credentials route)
// Gap #19: Digital Wallet (via credentials route)
// These are added to the credentials routes file
// ====================================================================

// ====================================================================
// Gap #3: Portfolio Development Templates
// ====================================================================

const PORTFOLIO_TEMPLATES = {
  electrician: {
    templateId: 'TPL-ELEC-01',
    trade: 'electrician',
    title: 'Electrician RPL Portfolio Template',
    sections: [
      { sectionId: 'personal', title: 'Personal Information & Trade Summary', description: 'Your trade background, years of experience, and areas of specialisation', required: true },
      { sectionId: 'qualifications', title: 'Formal Qualifications & Certificates', description: 'Trade certificates, safety cards, electrical licence copies', required: true },
      { sectionId: 'experience-letters', title: 'Employment & Experience Letters', description: 'Letters from current and previous employers confirming electrical work', required: true },
      { sectionId: 'reference-letters', title: 'Professional References', description: 'At least 2 reference letters from supervisors or senior electricians', required: true },
      { sectionId: 'work-samples', title: 'Work Samples & Photos', description: 'Photos of completed installations, panel work, wiring jobs', required: false },
      { sectionId: 'safety', title: 'Safety Training & PPE Records', description: 'Safety certifications, toolbox talk records, incident reports', required: true },
      { sectionId: 'tools', title: 'Tools & Equipment Competency', description: 'List of tools and equipment you can operate, with evidence', required: false },
      { sectionId: 'specialisation', title: 'Specialisation Evidence', description: 'Evidence for specific areas: industrial wiring, panel installation, solar, etc.', required: false },
    ],
  },
  welder: {
    templateId: 'TPL-WELD-01',
    trade: 'welder',
    title: 'Welder RPL Portfolio Template',
    sections: [
      { sectionId: 'personal', title: 'Personal Information & Trade Summary', description: 'Welding background, processes known (SMAW, MIG, TIG, etc.)', required: true },
      { sectionId: 'qualifications', title: 'Welding Certifications', description: 'AWS, ASME, or equivalent welding certificates', required: true },
      { sectionId: 'experience-letters', title: 'Employment & Experience Letters', description: 'Letters confirming welding work from employers', required: true },
      { sectionId: 'reference-letters', title: 'Professional References', description: 'References from welding supervisors or foremen', required: true },
      { sectionId: 'work-samples', title: 'Weld Samples & Photos', description: 'Photos of completed welds, joint types, NDT results', required: false },
      { sectionId: 'safety', title: 'Safety Training Records', description: 'Hot work permits, safety certifications, PPE records', required: true },
      { sectionId: 'materials', title: 'Materials Knowledge', description: 'Evidence of working with different metals and joint types', required: false },
    ],
  },
  mason: {
    templateId: 'TPL-MASON-01',
    trade: 'mason',
    title: 'Mason RPL Portfolio Template',
    sections: [
      { sectionId: 'personal', title: 'Personal Information & Trade Summary', description: 'Masonry background, structure types worked on', required: true },
      { sectionId: 'qualifications', title: 'Formal Qualifications', description: 'Trade certificates, training completion records', required: true },
      { sectionId: 'experience-letters', title: 'Employment & Experience Letters', description: 'Letters confirming masonry work from employers', required: true },
      { sectionId: 'reference-letters', title: 'Professional References', description: 'References from site engineers or supervisors', required: true },
      { sectionId: 'work-samples', title: 'Work Samples & Photos', description: 'Photos of walls, foundations, finishing work', required: false },
      { sectionId: 'safety', title: 'Safety Training', description: 'Working at heights, scaffolding safety records', required: true },
    ],
  },
  default: {
    templateId: 'TPL-DEFAULT-01',
    trade: 'general',
    title: 'General RPL Portfolio Template',
    sections: [
      { sectionId: 'personal', title: 'Personal Information & Trade Summary', description: 'Your trade background and experience overview', required: true },
      { sectionId: 'qualifications', title: 'Formal Qualifications & Certificates', description: 'All relevant trade certificates and training records', required: true },
      { sectionId: 'experience-letters', title: 'Employment & Experience Letters', description: 'Letters from employers confirming your work experience', required: true },
      { sectionId: 'reference-letters', title: 'Professional References', description: 'At least 2 professional reference letters', required: true },
      { sectionId: 'work-samples', title: 'Work Samples', description: 'Photos, documents, or other evidence of your work', required: false },
      { sectionId: 'safety', title: 'Safety Training', description: 'Safety certifications and training records', required: true },
    ],
  },
};

// GET /portfolio-templates — defined above (before /:id routes)

// POST /:id/portfolio-template — Apply a portfolio template to an assessment
router.post('/:id/portfolio-template', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Portfolio templates only apply to RPL assessments' });

    const template = PORTFOLIO_TEMPLATES[assessment.trade] || PORTFOLIO_TEMPLATES.default;

    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.portfolioTemplate = {
      templateId: template.templateId,
      trade: template.trade,
      sections: template.sections.map(s => ({
        sectionId: s.sectionId,
        title: s.title,
        description: s.description,
        required: s.required,
        completed: false,
        evidenceLinks: [],
        notes: '',
      })),
      progress: 0,
      startedAt: new Date(),
      lastUpdatedAt: new Date(),
    };
    await assessment.save();

    res.json({
      message: `Portfolio template applied: ${template.title}`,
      portfolioTemplate: assessment.rpl.portfolioTemplate,
    });
  } catch (err) { next(err); }
});

// PUT /:id/portfolio-template/:sectionId — Update a portfolio section
router.put('/:id/portfolio-template/:sectionId', authenticate, [
  param('id').isMongoId(),
  param('sectionId').trim().notEmpty(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (!assessment.rpl?.portfolioTemplate) return res.status(400).json({ error: 'No portfolio template applied' });

    const section = assessment.rpl.portfolioTemplate.sections.find(s => s.sectionId === req.params.sectionId);
    if (!section) return res.status(404).json({ error: 'Section not found' });

    if (req.body.completed !== undefined) {
      section.completed = req.body.completed;
      if (req.body.completed) section.completedAt = new Date();
    }
    if (req.body.evidenceLinks) section.evidenceLinks = req.body.evidenceLinks;
    if (req.body.notes !== undefined) section.notes = req.body.notes;

    // Recalculate progress
    const sections = assessment.rpl.portfolioTemplate.sections;
    const totalRequired = sections.filter(s => s.required).length;
    const completedRequired = sections.filter(s => s.required && s.completed).length;
    const completedOptional = sections.filter(s => !s.required && s.completed).length;
    const totalSections = sections.length;
    assessment.rpl.portfolioTemplate.progress = Math.round(
      ((completedRequired + completedOptional) / totalSections) * 100
    );
    assessment.rpl.portfolioTemplate.lastUpdatedAt = new Date();
    await assessment.save();

    res.json({
      message: `Section "${section.title}" updated`,
      section,
      progress: assessment.rpl.portfolioTemplate.progress,
    });
  } catch (err) { next(err); }
});

// GET /:id/portfolio-template — Get portfolio template progress
router.get('/:id/portfolio-template', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.portfolioTemplate type trade');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (!assessment.rpl?.portfolioTemplate) return res.json({ applied: false });

    const pt = assessment.rpl.portfolioTemplate;
    const requiredComplete = pt.sections.filter(s => s.required && s.completed).length;
    const totalRequired = pt.sections.filter(s => s.required).length;

    res.json({
      applied: true,
      templateId: pt.templateId,
      trade: pt.trade,
      progress: pt.progress,
      requiredComplete,
      totalRequired,
      allRequiredDone: requiredComplete === totalRequired,
      sections: pt.sections,
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #4: RPL Advisor / Facilitator Role
// ====================================================================

// POST /:id/advisor — Assign an RPL advisor
router.post('/:id/advisor', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('advisorId').isMongoId().withMessage('Valid advisor user ID required'),
  handleValidation,
], auditLog('RPL_ADVISOR_ASSIGN'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Advisors only apply to RPL assessments' });

    const advisor = await User.findById(req.body.advisorId);
    if (!advisor) return res.status(404).json({ error: 'Advisor user not found' });

    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.advisor = {
      assignedAdvisor: advisor._id,
      assignedAt: new Date(),
      guidanceNotes: [],
      meetingsCount: 0,
      status: 'assigned',
    };
    await assessment.save();

    res.json({
      message: `RPL advisor assigned: ${advisor.name}`,
      advisor: {
        _id: advisor._id,
        name: advisor.name,
        assignedAt: assessment.rpl.advisor.assignedAt,
        status: 'assigned',
      },
    });
  } catch (err) { next(err); }
});

// GET /:id/advisor — Get advisor details
router.get('/:id/advisor', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.advisor type')
      .populate('rpl.advisor.assignedAdvisor', 'name email');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (!assessment.rpl?.advisor?.assignedAdvisor) return res.json({ assigned: false });

    res.json({
      assigned: true,
      advisor: assessment.rpl.advisor,
    });
  } catch (err) { next(err); }
});

// POST /:id/advisor/guidance — Add a guidance note
router.post('/:id/advisor/guidance', authenticate, [
  param('id').isMongoId(),
  body('note').trim().notEmpty().isLength({ max: 2000 }),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (!assessment.rpl?.advisor?.assignedAdvisor) {
      return res.status(400).json({ error: 'No advisor assigned' });
    }

    // Only the assigned advisor or admin/institution can add notes
    const isAdvisor = assessment.rpl.advisor.assignedAdvisor.toString() === req.user._id.toString();
    const isAdmin = ['admin', 'institution'].includes(req.user.role);
    if (!isAdvisor && !isAdmin) return res.status(403).json({ error: 'Only assigned advisor can add guidance notes' });

    assessment.rpl.advisor.guidanceNotes.push({ note: req.body.note, createdAt: new Date() });
    assessment.rpl.advisor.status = 'active';
    await assessment.save();

    res.json({
      message: 'Guidance note added',
      totalNotes: assessment.rpl.advisor.guidanceNotes.length,
      note: assessment.rpl.advisor.guidanceNotes[assessment.rpl.advisor.guidanceNotes.length - 1],
    });
  } catch (err) { next(err); }
});

// PUT /:id/advisor/meeting — Record an advisor meeting
router.put('/:id/advisor/meeting', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (!assessment.rpl?.advisor?.assignedAdvisor) {
      return res.status(400).json({ error: 'No advisor assigned' });
    }

    assessment.rpl.advisor.meetingsCount = (assessment.rpl.advisor.meetingsCount || 0) + 1;
    assessment.rpl.advisor.lastMeetingAt = new Date();
    if (req.body.notes) {
      assessment.rpl.advisor.guidanceNotes.push({ note: `Meeting: ${req.body.notes}`, createdAt: new Date() });
    }
    await assessment.save();

    res.json({
      message: 'Meeting recorded',
      meetingsCount: assessment.rpl.advisor.meetingsCount,
      lastMeetingAt: assessment.rpl.advisor.lastMeetingAt,
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #9: Simulation / Scenario-Based Assessment
// ====================================================================

const SCENARIO_BANK = {
  electrician: [
    {
      scenarioId: 'ELEC-SC-01', title: 'Faulty Circuit Diagnosis',
      description: 'A residential building has intermittent power loss in one circuit. Diagnose and fix the issue.',
      difficulty: 'intermediate',
      steps: [
        { stepNumber: 1, instruction: 'Identify the affected circuit on the distribution board', expectedAction: 'Locate tripping breaker or fuse' },
        { stepNumber: 2, instruction: 'Describe your safety procedure before testing', expectedAction: 'Isolate circuit, test with voltmeter, wear PPE' },
        { stepNumber: 3, instruction: 'Diagnose the root cause', expectedAction: 'Check for short circuit, overload, or earth fault' },
        { stepNumber: 4, instruction: 'Describe the repair procedure', expectedAction: 'Replace damaged wiring/connection, test insulation' },
        { stepNumber: 5, instruction: 'What post-repair testing would you perform?', expectedAction: 'Insulation resistance test, continuity test, functional test' },
      ],
    },
    {
      scenarioId: 'ELEC-SC-02', title: 'Three-Phase Panel Installation',
      description: 'Install a three-phase distribution panel for a commercial kitchen.',
      difficulty: 'advanced',
      steps: [
        { stepNumber: 1, instruction: 'List the safety measures before starting', expectedAction: 'LOTO, PPE, permit to work, barrier tape' },
        { stepNumber: 2, instruction: 'Describe the panel layout and load balancing', expectedAction: 'Balance loads across R/Y/B phases, separate lighting and power' },
        { stepNumber: 3, instruction: 'How would you size the main breaker and sub-breakers?', expectedAction: 'Calculate total load, apply diversity factor, select appropriate ratings' },
        { stepNumber: 4, instruction: 'Describe the earthing arrangement', expectedAction: 'TN-S or TN-C-S, earth bus, bonding' },
      ],
    },
  ],
  welder: [
    {
      scenarioId: 'WELD-SC-01', title: 'Pipe Joint Welding Scenario',
      description: 'You need to weld a 6-inch carbon steel pipe joint using SMAW in the 6G position.',
      difficulty: 'advanced',
      steps: [
        { stepNumber: 1, instruction: 'Describe joint preparation procedure', expectedAction: 'Bevel angle, root gap, root face, cleaning' },
        { stepNumber: 2, instruction: 'Select the appropriate electrode and settings', expectedAction: 'E6010 for root, E7018 for fill/cap, correct amperage' },
        { stepNumber: 3, instruction: 'Describe your welding technique for the root pass', expectedAction: 'Keyhole technique, maintain consistent arc length' },
        { stepNumber: 4, instruction: 'What defects would you check for?', expectedAction: 'Porosity, undercut, lack of fusion, incomplete penetration' },
      ],
    },
  ],
  mason: [
    {
      scenarioId: 'MASON-SC-01', title: 'Foundation Wall Construction',
      description: 'Build a foundation wall on a prepared footing for a single-storey building.',
      difficulty: 'intermediate',
      steps: [
        { stepNumber: 1, instruction: 'Describe how you establish the first course', expectedAction: 'Check level, use string line, set corner blocks first' },
        { stepNumber: 2, instruction: 'What mortar mix ratio would you use?', expectedAction: '1:3 or 1:4 cement:sand ratio, proper consistency' },
        { stepNumber: 3, instruction: 'How do you ensure wall is plumb and level?', expectedAction: 'Spirit level, plumb bob, string lines, regular checking' },
        { stepNumber: 4, instruction: 'Describe DPC installation', expectedAction: 'Damp proof course at specified height, continuous membrane' },
      ],
    },
  ],
};

// GET /scenarios — defined above (before /:id routes)

// POST /:id/scenario — Start a scenario assessment
router.post('/:id/scenario', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('id').isMongoId(),
  body('scenarioId').trim().notEmpty(),
  handleValidation,
], auditLog('RPL_SCENARIO_START'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Scenarios only apply to RPL assessments' });

    // Find scenario from bank
    const tradeScenarios = SCENARIO_BANK[assessment.trade] || [];
    const template = tradeScenarios.find(s => s.scenarioId === req.body.scenarioId);
    if (!template) return res.status(404).json({ error: `Scenario ${req.body.scenarioId} not found for trade ${assessment.trade}` });

    if (!assessment.rpl) assessment.rpl = {};
    if (!assessment.rpl.scenarios) assessment.rpl.scenarios = [];

    // Check duplicate
    const exists = assessment.rpl.scenarios.find(s => s.scenarioId === template.scenarioId);
    if (exists) return res.status(409).json({ error: 'Scenario already added to this assessment' });

    assessment.rpl.scenarios.push({
      scenarioId: template.scenarioId,
      title: template.title,
      description: template.description,
      trade: assessment.trade,
      difficulty: template.difficulty,
      steps: template.steps.map(st => ({
        stepNumber: st.stepNumber,
        instruction: st.instruction,
        expectedAction: st.expectedAction,
      })),
      passingScore: 60,
      startedAt: new Date(),
    });
    await assessment.save();

    const added = assessment.rpl.scenarios[assessment.rpl.scenarios.length - 1];
    res.status(201).json({ message: `Scenario started: ${template.title}`, scenario: added });
  } catch (err) { next(err); }
});

// PUT /:id/scenario/:scenarioId — Submit scenario responses and scoring
router.put('/:id/scenario/:scenarioId', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('id').isMongoId(),
  param('scenarioId').trim().notEmpty(),
  body('responses').isArray({ min: 1 }),
  handleValidation,
], auditLog('RPL_SCENARIO_SUBMIT'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const scenario = assessment.rpl?.scenarios?.find(s => s.scenarioId === req.params.scenarioId);
    if (!scenario) return res.status(404).json({ error: 'Scenario not found on this assessment' });

    // Apply responses
    for (const resp of req.body.responses) {
      const step = scenario.steps.find(s => s.stepNumber === resp.stepNumber);
      if (step) {
        step.candidateResponse = resp.response;
        step.score = resp.score;
        step.assessorNotes = resp.notes;
      }
    }

    // Calculate overall score
    const scoredSteps = scenario.steps.filter(s => s.score !== undefined && s.score !== null);
    const totalScore = scoredSteps.length > 0
      ? Math.round(scoredSteps.reduce((s, st) => s + st.score, 0) / (scoredSteps.length * 4) * 100)
      : 0;

    scenario.overallScore = totalScore;
    scenario.passed = totalScore >= scenario.passingScore;
    scenario.completedAt = new Date();
    scenario.assessorNotes = req.body.assessorNotes;

    // Update stage completed if all scenarios pass
    const allPassed = assessment.rpl.scenarios.every(s => s.passed);
    assessment.rpl.stageCompleted.scenario = allPassed;

    await assessment.save();

    res.json({
      message: `Scenario ${scenario.passed ? 'passed' : 'failed'}: ${scenario.title}`,
      scenario: { scenarioId: scenario.scenarioId, overallScore: totalScore, passed: scenario.passed },
    });
  } catch (err) { next(err); }
});

// GET /:id/scenarios — Get all scenarios for an assessment
router.get('/:id/scenarios', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.scenarios rpl.stageCompleted.scenario type');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    res.json({
      total: (assessment.rpl?.scenarios || []).length,
      stageCompleted: assessment.rpl?.stageCompleted?.scenario || false,
      scenarios: assessment.rpl?.scenarios || [],
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #12: Competency Conversation as Standalone Method
// ====================================================================

// PUT /:id/competency-conversation — Record a competency conversation
router.put('/:id/competency-conversation', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('id').isMongoId(),
  body('topics').isArray({ min: 1 }),
  body('format').optional().isIn(['in-person', 'video-call', 'phone']),
  body('durationMinutes').optional().isInt({ min: 1 }).toInt(),
  handleValidation,
], auditLog('RPL_COMPETENCY_CONVERSATION'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Competency conversations only apply to RPL assessments' });

    if (!assessment.rpl) assessment.rpl = {};

    const topics = req.body.topics.map(t => ({
      competencyArea: t.competencyArea,
      questions: t.questions || [],
      candidateSummary: t.candidateSummary,
      evidenceReferenced: t.evidenceReferenced || [],
      rating: t.rating,
      notes: t.notes,
    }));

    // Calculate overall score
    const ratedTopics = topics.filter(t => t.rating !== undefined && t.rating !== null);
    const overallScore = ratedTopics.length > 0
      ? Math.round(ratedTopics.reduce((s, t) => s + t.rating, 0) / (ratedTopics.length * 4) * 100)
      : 0;

    // Determine recommendation
    let recommendation;
    if (overallScore >= 75) recommendation = 'competent';
    else if (overallScore >= 50) recommendation = 'needs-further-evidence';
    else if (overallScore >= 30) recommendation = 'refer-to-practical';
    else recommendation = 'not-yet-competent';

    assessment.rpl.competencyConversation = {
      conductedAt: new Date(),
      durationMinutes: req.body.durationMinutes,
      assessor: req.user._id,
      format: req.body.format || 'in-person',
      topics,
      overallImpression: req.body.overallImpression,
      overallScore,
      recommendation,
      recordingUrl: req.body.recordingUrl,
      transcriptUrl: req.body.transcriptUrl,
    };

    assessment.rpl.stageCompleted.competencyConversation = overallScore >= 50;
    await assessment.save();

    res.json({
      message: `Competency conversation recorded: ${recommendation}`,
      competencyConversation: assessment.rpl.competencyConversation,
    });
  } catch (err) { next(err); }
});

// GET /:id/competency-conversation — Get competency conversation details
router.get('/:id/competency-conversation', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.competencyConversation rpl.stageCompleted.competencyConversation type');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    res.json({
      completed: assessment.rpl?.stageCompleted?.competencyConversation || false,
      conversation: assessment.rpl?.competencyConversation || null,
    });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #16: Inter-Rater Reliability Checks
// ====================================================================

const RELIABILITY_THRESHOLD = 15; // Max acceptable point difference

// POST /:id/inter-rater — Request an inter-rater reliability check
router.post('/:id/inter-rater', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('secondAssessorId').isMongoId().withMessage('Second assessor ID required'),
  handleValidation,
], auditLog('RPL_INTER_RATER_REQUEST'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Inter-rater checks only apply to RPL assessments' });
    if (assessment.rpl?.interRaterCheck?.status === 'pending') {
      return res.status(409).json({ error: 'Inter-rater check already pending' });
    }

    const secondAssessor = await User.findById(req.body.secondAssessorId);
    if (!secondAssessor) return res.status(404).json({ error: 'Second assessor not found' });
    if (secondAssessor._id.toString() === assessment.assessor.toString()) {
      return res.status(400).json({ error: 'Second assessor must be different from primary assessor' });
    }

    if (!assessment.rpl) assessment.rpl = {};
    assessment.rpl.interRaterCheck = {
      secondAssessor: secondAssessor._id,
      requestedAt: new Date(),
      requestedBy: req.user._id,
      status: 'pending',
    };
    await assessment.save();

    res.status(201).json({
      message: `Inter-rater check requested from ${secondAssessor.name}`,
      interRaterCheck: {
        secondAssessor: { _id: secondAssessor._id, name: secondAssessor.name },
        status: 'pending',
        requestedAt: assessment.rpl.interRaterCheck.requestedAt,
      },
    });
  } catch (err) { next(err); }
});

// PUT /:id/inter-rater — Submit second assessor's scores
router.put('/:id/inter-rater', authenticate, authorize('admin', 'assessor', 'institution'), [
  param('id').isMongoId(),
  body('interview').optional().isInt({ min: 0, max: 100 }).toInt(),
  body('practicalDemo').optional().isInt({ min: 0, max: 100 }).toInt(),
  body('evidenceQuality').optional().isInt({ min: 0, max: 100 }).toInt(),
  body('overallDecision').isIn(['approved', 'rejected']),
  handleValidation,
], auditLog('RPL_INTER_RATER_SUBMIT'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (!assessment.rpl?.interRaterCheck) return res.status(400).json({ error: 'No inter-rater check requested' });
    if (assessment.rpl.interRaterCheck.status === 'completed') {
      return res.status(400).json({ error: 'Inter-rater check already completed' });
    }

    const irc = assessment.rpl.interRaterCheck;

    // Store second assessor's scores
    irc.secondScores = {
      interview: req.body.interview,
      practicalDemo: req.body.practicalDemo,
      evidenceQuality: req.body.evidenceQuality,
      overallDecision: req.body.overallDecision,
      notes: req.body.notes,
    };

    // Get primary assessor's scores for comparison
    const primaryInterview = assessment.rpl?.interview?.items?.length > 0
      ? Math.round(assessment.rpl.interview.items.reduce((s, i) => s + (i.score || 0), 0) / (assessment.rpl.interview.items.length * 4) * 100)
      : null;
    const primaryPractical = assessment.rpl?.practicalDemo?.totalScore || null;
    const primaryDecision = assessment.rpl?.assessorDecision || assessment.status;

    // Calculate agreement
    const interviewDiff = (primaryInterview !== null && req.body.interview !== undefined) ? Math.abs(primaryInterview - req.body.interview) : null;
    const practicalDiff = (primaryPractical !== null && req.body.practicalDemo !== undefined) ? Math.abs(primaryPractical - req.body.practicalDemo) : null;
    const evidenceDiff = req.body.evidenceQuality !== undefined ? Math.abs(50 - req.body.evidenceQuality) : null; // Compared to baseline 50

    const decisionMatch = (primaryDecision === 'approved' || primaryDecision === 'rejected')
      ? primaryDecision === req.body.overallDecision
      : true;

    // Calculate reliability score (100 = perfect agreement)
    const diffs = [interviewDiff, practicalDiff, evidenceDiff].filter(d => d !== null);
    const avgDiff = diffs.length > 0 ? diffs.reduce((s, d) => s + d, 0) / diffs.length : 0;
    const reliabilityScore = Math.max(0, Math.round(100 - avgDiff));
    const withinThreshold = diffs.every(d => d <= RELIABILITY_THRESHOLD) && decisionMatch;

    irc.agreement = {
      interviewDiff,
      practicalDiff,
      evidenceDiff,
      decisionMatch,
      reliabilityScore,
      withinThreshold,
    };

    irc.resolution = {
      needed: !withinThreshold,
    };

    irc.completedAt = new Date();
    irc.status = 'completed';

    await assessment.save();

    res.json({
      message: withinThreshold ? 'Inter-rater check passed — scores within threshold' : 'Inter-rater check flagged — resolution needed',
      interRaterCheck: {
        secondScores: irc.secondScores,
        agreement: irc.agreement,
        resolutionNeeded: !withinThreshold,
      },
    });
  } catch (err) { next(err); }
});

// PUT /:id/inter-rater/resolve — Resolve disagreement
router.put('/:id/inter-rater/resolve', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('finalDecision').isIn(['approved', 'rejected']),
  body('notes').optional().trim().isLength({ max: 1000 }),
  handleValidation,
], auditLog('RPL_INTER_RATER_RESOLVE'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (!assessment.rpl?.interRaterCheck?.agreement) return res.status(400).json({ error: 'No inter-rater check to resolve' });
    if (assessment.rpl.interRaterCheck.resolution?.resolvedAt) {
      return res.status(400).json({ error: 'Already resolved' });
    }
    if (assessment.rpl.interRaterCheck.agreement?.withinThreshold === true) {
      return res.status(400).json({ error: 'No resolution needed — scores within threshold' });
    }

    assessment.rpl.interRaterCheck.resolution = {
      needed: true,
      resolvedBy: req.user._id,
      finalDecision: req.body.finalDecision,
      notes: req.body.notes,
      resolvedAt: new Date(),
    };
    await assessment.save();

    res.json({
      message: `Inter-rater disagreement resolved: ${req.body.finalDecision}`,
      resolution: assessment.rpl.interRaterCheck.resolution,
    });
  } catch (err) { next(err); }
});

// GET /:id/inter-rater — Get inter-rater check status
router.get('/:id/inter-rater', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id)
      .select('rpl.interRaterCheck type')
      .populate('rpl.interRaterCheck.secondAssessor', 'name email');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    res.json(assessment.rpl?.interRaterCheck || { status: 'none' });
  } catch (err) { next(err); }
});

// GET /assessor-dashboard/:assessorId — defined above (before /:id routes)

// ====================================================================
// Gap #32: Fee Management Routes
// ====================================================================

// POST /:id/fees — Add fee line item
router.post('/:id/fees', authenticate, authorize('admin', 'institution', 'assessor'), [
  param('id').isMongoId(),
  body('feeType').trim().notEmpty().isLength({ max: 100 }),
  body('amount').isFloat({ min: 0 }).toFloat(),
  body('currency').optional().trim().isLength({ max: 10 }),
  body('dueDate').optional().isISO8601(),
  handleValidation,
], auditLog('RPL_FEE_ADD'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Fee tracking only applies to RPL assessments' });

    if (!assessment.rpl) assessment.rpl = {};
    if (!assessment.rpl.fees) assessment.rpl.fees = { items: [], totalAmount: 0, totalPaid: 0, totalWaived: 0, totalOutstanding: 0 };

    const item = {
      feeType: req.body.feeType,
      amount: req.body.amount,
      currency: req.body.currency || 'PKR',
      status: 'pending',
      dueDate: req.body.dueDate ? new Date(req.body.dueDate) : undefined,
    };

    assessment.rpl.fees.items.push(item);

    // Recalculate totals
    const items = assessment.rpl.fees.items;
    assessment.rpl.fees.totalAmount = items.reduce((s, i) => s + i.amount, 0);
    assessment.rpl.fees.totalPaid = items.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
    assessment.rpl.fees.totalWaived = items.filter(i => i.status === 'waived').reduce((s, i) => s + i.amount, 0);
    assessment.rpl.fees.totalOutstanding = assessment.rpl.fees.totalAmount - assessment.rpl.fees.totalPaid - assessment.rpl.fees.totalWaived;

    await assessment.save();
    res.status(201).json({ message: 'Fee item added', fees: assessment.rpl.fees });
  } catch (err) { next(err); }
});

// PUT /:id/fees/:feeId — Update fee status (paid/waived/refunded)
router.put('/:id/fees/:feeId', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  param('feeId').isMongoId(),
  body('status').isIn(['pending', 'paid', 'waived', 'refunded', 'overdue']),
  body('paymentReference').optional().trim().isLength({ max: 200 }),
  body('waivedReason').optional().trim().isLength({ max: 500 }),
  handleValidation,
], auditLog('RPL_FEE_UPDATE'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const item = assessment.rpl?.fees?.items?.id(req.params.feeId);
    if (!item) return res.status(404).json({ error: 'Fee item not found' });

    item.status = req.body.status;
    if (req.body.status === 'paid') item.paidDate = new Date();
    if (req.body.paymentReference) item.paymentReference = req.body.paymentReference;
    if (req.body.waivedReason) item.waivedReason = req.body.waivedReason;

    // Recalculate totals
    const items = assessment.rpl.fees.items;
    assessment.rpl.fees.totalAmount = items.reduce((s, i) => s + i.amount, 0);
    assessment.rpl.fees.totalPaid = items.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
    assessment.rpl.fees.totalWaived = items.filter(i => i.status === 'waived').reduce((s, i) => s + i.amount, 0);
    assessment.rpl.fees.totalOutstanding = assessment.rpl.fees.totalAmount - assessment.rpl.fees.totalPaid - assessment.rpl.fees.totalWaived;

    await assessment.save();
    res.json({ message: 'Fee item updated', fees: assessment.rpl.fees });
  } catch (err) { next(err); }
});

// GET /:id/fees — Get fee summary
router.get('/:id/fees', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id).select('rpl.fees type');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    res.json(assessment.rpl?.fees || { items: [], totalAmount: 0, totalPaid: 0, totalWaived: 0, totalOutstanding: 0 });
  } catch (err) { next(err); }
});

// DELETE /:id/fees/:feeId — Remove fee item (admin only)
router.delete('/:id/fees/:feeId', authenticate, authorize('admin'), [
  param('id').isMongoId(),
  param('feeId').isMongoId(),
  handleValidation,
], auditLog('RPL_FEE_DELETE'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const item = assessment.rpl?.fees?.items?.id(req.params.feeId);
    if (!item) return res.status(404).json({ error: 'Fee item not found' });

    item.deleteOne();

    // Recalculate totals
    const items = assessment.rpl.fees.items;
    assessment.rpl.fees.totalAmount = items.reduce((s, i) => s + i.amount, 0);
    assessment.rpl.fees.totalPaid = items.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
    assessment.rpl.fees.totalWaived = items.filter(i => i.status === 'waived').reduce((s, i) => s + i.amount, 0);
    assessment.rpl.fees.totalOutstanding = assessment.rpl.fees.totalAmount - assessment.rpl.fees.totalPaid - assessment.rpl.fees.totalWaived;

    await assessment.save();
    res.json({ message: 'Fee item removed', fees: assessment.rpl.fees });
  } catch (err) { next(err); }
});

// POST /:id/fees/apply-schedule — Apply fee schedule template
router.post('/:id/fees/apply-schedule', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('scheduleId').isIn(Object.keys(FEE_SCHEDULES)).withMessage('Invalid fee schedule'),
  handleValidation,
], auditLog('RPL_FEE_APPLY_SCHEDULE'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Fee tracking only applies to RPL assessments' });

    if (!assessment.rpl) assessment.rpl = {};
    if (!assessment.rpl.fees) assessment.rpl.fees = { items: [], totalAmount: 0, totalPaid: 0, totalWaived: 0, totalOutstanding: 0 };

    const schedule = FEE_SCHEDULES[req.body.scheduleId];
    for (const tmpl of schedule.items) {
      assessment.rpl.fees.items.push({
        feeType: tmpl.feeType,
        amount: tmpl.amount,
        currency: schedule.currency,
        status: 'pending',
      });
    }

    // Recalculate totals
    const items = assessment.rpl.fees.items;
    assessment.rpl.fees.totalAmount = items.reduce((s, i) => s + i.amount, 0);
    assessment.rpl.fees.totalPaid = items.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
    assessment.rpl.fees.totalWaived = items.filter(i => i.status === 'waived').reduce((s, i) => s + i.amount, 0);
    assessment.rpl.fees.totalOutstanding = assessment.rpl.fees.totalAmount - assessment.rpl.fees.totalPaid - assessment.rpl.fees.totalWaived;

    await assessment.save();
    res.json({ message: `Fee schedule ${req.body.scheduleId} applied`, fees: assessment.rpl.fees });
  } catch (err) { next(err); }
});

// ====================================================================
// Gap #28: RPL-to-Work-Permit Linkage
// ====================================================================

// POST /:id/work-permit-link — Link approved RPL assessment to worker's work permit
router.post('/:id/work-permit-link', authenticate, authorize('admin', 'institution'), [
  param('id').isMongoId(),
  body('permitNumber').optional().trim().isLength({ max: 100 }),
  body('issuingAuthority').optional().trim().isLength({ max: 200 }),
  body('issuingCountry').optional().trim().isLength({ max: 100 }),
  body('occupation').optional().trim().isLength({ max: 200 }),
  body('sponsorName').optional().trim().isLength({ max: 200 }),
  handleValidation,
], auditLog('RPL_WORK_PERMIT_LINK'), async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });
    if (assessment.type !== 'rpl') return res.status(400).json({ error: 'Work permit linkage only applies to RPL assessments' });
    if (assessment.status !== 'approved') return res.status(400).json({ error: 'Assessment must be approved before linking to work permit' });

    const worker = await Worker.findById(assessment.worker);
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    // Update worker's work permit
    if (!worker.workPermit) worker.workPermit = {};
    if (req.body.permitNumber) worker.workPermit.permitNumber = req.body.permitNumber;
    if (req.body.issuingAuthority) worker.workPermit.issuingAuthority = req.body.issuingAuthority;
    if (req.body.issuingCountry) worker.workPermit.issuingCountry = req.body.issuingCountry;
    if (req.body.occupation) worker.workPermit.occupation = req.body.occupation;
    if (req.body.sponsorName) worker.workPermit.sponsorName = req.body.sponsorName;
    worker.workPermit.linkedAssessment = assessment._id;

    // Link credential if exists
    if (assessment.credentialId) {
      if (!worker.workPermit.linkedCredentials) worker.workPermit.linkedCredentials = [];
      if (!worker.workPermit.linkedCredentials.some(c => c.toString() === assessment.credentialId.toString())) {
        worker.workPermit.linkedCredentials.push(assessment.credentialId);
      }
    }

    await worker.save();

    res.json({
      message: 'Work permit linked to RPL assessment',
      workPermit: worker.workPermit,
      assessmentId: assessment._id,
    });
  } catch (err) { next(err); }
});

// GET /:id/work-permit-link — Get work permit linkage info
router.get('/:id/work-permit-link', authenticate, [
  param('id').isMongoId(),
  handleValidation,
], async (req, res, next) => {
  try {
    const assessment = await Assessment.findById(req.params.id).select('worker type status credentialId');
    if (!assessment) return res.status(404).json({ error: 'Assessment not found' });

    const worker = await Worker.findById(assessment.worker).select('workPermit fullName trade');
    if (!worker) return res.status(404).json({ error: 'Worker not found' });

    const linked = worker.workPermit?.linkedAssessment?.toString() === assessment._id.toString();
    res.json({
      linked,
      assessmentStatus: assessment.status,
      workPermit: worker.workPermit || {},
      worker: { fullName: worker.fullName, trade: worker.trade },
    });
  } catch (err) { next(err); }
});

export default router;
