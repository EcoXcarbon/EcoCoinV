#!/usr/bin/env node
/**
 * Expands NAVTTC and Gulf curricula JSON files:
 * 1. Quiz banks: 6 → 18 questions per trade (add 12 multi-type questions)
 * 2. Knowledge checks: 2-3 questions per video/reading module
 * 3. Rubric templates: 4-6 criteria per practical/assignment module
 */
const fs = require('fs');
const path = require('path');

// ─── Trade-specific question templates ───
// Maps trade → array of extra questions (12 per trade)
function generateExtraQuizQuestions(trade, competencyTargets, nqfLevel, framework) {
  const skills = competencyTargets.map(ct => ct.skill);
  const isGulf = framework && framework.toLowerCase().includes('gulf');

  // Generic trade knowledge mapped by trade category
  const tradeQuestions = getTradeSpecificQuestions(trade, skills, nqfLevel, isGulf);
  return tradeQuestions;
}

function getTradeSpecificQuestions(trade, skills, nqfLevel, isGulf) {
  const s = skills;
  const safetySkill = s.find(sk => /safety|ohs|hse/i.test(sk)) || s[0];
  const primarySkill = s.find(sk => !/safety|ohs|hse/i.test(sk)) || s[1] || s[0];
  const secondarySkill = s[2] || primarySkill;
  const tertiarySkill = s[3] || secondarySkill;
  const fourthSkill = s[4] || tertiarySkill;

  // Build trade-specific question bank
  const tradeData = TRADE_QUESTION_BANK[trade] || TRADE_QUESTION_BANK._default;
  const questions = [];

  // 4 additional MCQs
  for (let i = 0; i < 4; i++) {
    const q = tradeData.mcqs[i] || {
      question: `Which standard governs ${trade} work quality at NQF Level ${nqfLevel}?`,
      options: ['Local standard', 'International standard', 'Both local and international', 'No specific standard'],
      correctOption: 2,
    };
    questions.push({
      ...q,
      type: 'mcq',
      difficulty: ['easy', 'medium', 'medium', 'hard'][i],
      competencyTag: [safetySkill, primarySkill, secondarySkill, tertiarySkill][i],
      points: 1,
    });
  }

  // 2 true-false
  const tfs = tradeData.trueFalse || [
    { question: `PPE is optional when performing ${trade} tasks.`, correctAnswer: 'false' },
    { question: `Quality checks should be performed at every stage of ${trade} work.`, correctAnswer: 'true' },
  ];
  questions.push({ ...tfs[0], type: 'true-false', difficulty: 'easy', competencyTag: safetySkill, points: 1 });
  questions.push({ ...tfs[1], type: 'true-false', difficulty: 'medium', competencyTag: primarySkill, points: 1 });

  // 2 fill-blank
  const fbs = tradeData.fillBlank || [
    { question: `The most important safety device on site is ___.`, correctAnswer: 'PPE', acceptableAnswers: ['PPE', 'personal protective equipment'] },
    { question: `Quality assurance in ${trade} requires regular ___.`, correctAnswer: 'inspection', acceptableAnswers: ['inspection', 'inspections', 'checks'] },
  ];
  questions.push({ ...fbs[0], type: 'fill-blank', difficulty: 'easy', competencyTag: safetySkill, points: 1 });
  questions.push({ ...fbs[1], type: 'fill-blank', difficulty: 'medium', competencyTag: secondarySkill, points: 1 });

  // 1 matching
  const matching = tradeData.matching || {
    question: `Match the ${trade} tool with its primary use`,
    matchPairs: [
      { left: 'Tool A', right: 'Use A' },
      { left: 'Tool B', right: 'Use B' },
      { left: 'Tool C', right: 'Use C' },
    ],
  };
  questions.push({ ...matching, type: 'matching', difficulty: 'medium', competencyTag: primarySkill, points: 2 });

  // 1 ordering
  const ordering = tradeData.ordering || {
    question: `Arrange the ${trade} work steps in the correct order`,
    correctOrder: ['Prepare materials', 'Set up workspace', 'Execute task', 'Quality check', 'Clean up'],
  };
  questions.push({ ...ordering, type: 'ordering', difficulty: 'hard', competencyTag: tertiarySkill, points: 2 });

  // 1 short-answer
  const shortAns = tradeData.shortAnswer || {
    question: `Name three essential safety precautions for ${trade} work.`,
    correctAnswer: 'PPE, hazard assessment, proper ventilation',
    acceptableAnswers: ['PPE', 'safety equipment', 'hazard assessment', 'ventilation', 'training'],
  };
  questions.push({ ...shortAns, type: 'short-answer', difficulty: 'medium', competencyTag: safetySkill, points: 2 });

  // 1 essay
  const essay = tradeData.essay || {
    question: `Describe the complete safety procedure before starting ${trade} work on site.`,
    essayRubric: 'risk assessment;PPE;permits;hazard identification;emergency procedures',
  };
  questions.push({ ...essay, type: 'essay', difficulty: 'hard', competencyTag: fourthSkill, points: 3 });

  return questions;
}

// ─── Trade-specific question banks ───
const TRADE_QUESTION_BANK = {
  mason: {
    mcqs: [
      { question: 'What is the standard thickness of a mortar joint in brickwork?', options: ['5mm', '10mm', '15mm', '20mm'], correctOption: 1 },
      { question: 'Which bond pattern has alternating headers and stretchers in every course?', options: ['Stretcher bond', 'English bond', 'Flemish bond', 'Header bond'], correctOption: 2 },
      { question: 'What is the purpose of a spirit level in masonry?', options: ['Mixing mortar', 'Checking alignment', 'Cutting bricks', 'Measuring distance'], correctOption: 1 },
      { question: 'What is the minimum curing period for a masonry wall?', options: ['1 day', '3 days', '7 days', '14 days'], correctOption: 2 },
    ],
    trueFalse: [
      { question: 'Bricks should be soaked in water before laying to prevent rapid moisture absorption from mortar.', correctAnswer: 'true' },
      { question: 'English bond is weaker than stretcher bond for load-bearing walls.', correctAnswer: 'false' },
    ],
    fillBlank: [
      { question: 'A plumb bob is used to check the ___ of a wall.', correctAnswer: 'verticality', acceptableAnswers: ['verticality', 'vertical alignment', 'plumb'] },
      { question: 'The process of filling mortar joints after laying is called ___.', correctAnswer: 'pointing', acceptableAnswers: ['pointing', 'jointing'] },
    ],
    matching: { question: 'Match the masonry tool with its use', matchPairs: [{ left: 'Trowel', right: 'Spreading mortar' }, { left: 'Spirit level', right: 'Checking horizontal alignment' }, { left: 'Plumb bob', right: 'Checking vertical alignment' }] },
    ordering: { question: 'Arrange brick wall construction steps in order', correctOrder: ['Set out foundation line', 'Lay corner bricks', 'String line between corners', 'Lay intermediate bricks', 'Check level and plumb', 'Point joints'] },
    shortAnswer: { question: 'Name three factors that affect mortar workability.', correctAnswer: 'Water content, sand quality, mixing time', acceptableAnswers: ['water', 'sand', 'cement ratio', 'mixing', 'temperature', 'additives'] },
    essay: { question: 'Explain the procedure for constructing a half-brick wall in stretcher bond, including material preparation and quality checks.', essayRubric: 'foundation;mortar preparation;brick soaking;string line;level check;plumb;pointing;curing' },
  },
  electrician: {
    mcqs: [
      { question: 'What is the color code for the earth wire in BS 7671?', options: ['Brown', 'Blue', 'Green/Yellow', 'Grey'], correctOption: 2 },
      { question: 'What is the minimum insulation resistance for a 230V circuit?', options: ['0.5 MΩ', '1 MΩ', '2 MΩ', '0.25 MΩ'], correctOption: 1 },
      { question: 'Which device detects earth leakage current?', options: ['MCB', 'RCD', 'Fuse', 'Isolator'], correctOption: 1 },
      { question: 'What is the maximum Zs for a 32A Type B MCB on TN-S?', options: ['0.80Ω', '1.09Ω', '1.44Ω', '2.30Ω'], correctOption: 2 },
    ],
    trueFalse: [
      { question: 'A GS38 approved voltage tester must be used to prove dead before working on circuits.', correctAnswer: 'true' },
      { question: 'Ring final circuits can safely use 1.0mm² cable.', correctAnswer: 'false' },
    ],
    fillBlank: [
      { question: 'The standard domestic ring circuit uses ___ mm² cable.', correctAnswer: '2.5', acceptableAnswers: ['2.5', '2.5mm'] },
      { question: 'LOTO stands for Lock Out ___ Out.', correctAnswer: 'Tag', acceptableAnswers: ['Tag', 'tag'] },
    ],
    matching: { question: 'Match the test with the correct instrument', matchPairs: [{ left: 'Insulation resistance', right: 'Megger' }, { left: 'Earth loop impedance', right: 'Loop tester' }, { left: 'Continuity', right: 'Low-resistance ohmmeter' }] },
    ordering: { question: 'Arrange the safe isolation procedure in order', correctOrder: ['Identify circuit', 'Switch off supply', 'Lock off and tag', 'Prove tester on known source', 'Test for dead', 'Prove tester again'] },
    shortAnswer: { question: 'List three types of earthing systems defined in BS 7671.', correctAnswer: 'TN-S, TN-C-S, TT', acceptableAnswers: ['TN-S', 'TN-C-S', 'TT', 'TN-C', 'IT'] },
    essay: { question: 'Describe the complete procedure for safe isolation of a circuit, including all verification steps required by GS38.', essayRubric: 'identify circuit;switch off;lock out;tag out;prove tester;test dead;prove tester again;GS38' },
  },
  welder: {
    mcqs: [
      { question: 'What shielding gas is commonly used in MIG welding of mild steel?', options: ['Pure argon', 'CO2/Argon mix', 'Helium', 'Nitrogen'], correctOption: 1 },
      { question: 'What is the purpose of a root pass in multi-pass welding?', options: ['Decorative finish', 'Foundation penetration', 'Heat dissipation', 'Filler only'], correctOption: 1 },
      { question: 'Which welding position is designated as 3G?', options: ['Flat', 'Horizontal', 'Vertical', 'Overhead'], correctOption: 2 },
      { question: 'What defect results from excessive travel speed?', options: ['Porosity', 'Undercut', 'Overlap', 'Burn-through'], correctOption: 1 },
    ],
    trueFalse: [
      { question: 'An auto-darkening welding helmet must be tested before each use.', correctAnswer: 'true' },
      { question: 'Welding on galvanized steel produces no harmful fumes.', correctAnswer: 'false' },
    ],
    fillBlank: [
      { question: 'The minimum shade number for arc welding is DIN ___.', correctAnswer: '10', acceptableAnswers: ['10', '11', '10-11'] },
      { question: 'AWS D1.1 is the structural welding code for ___.', correctAnswer: 'steel', acceptableAnswers: ['steel', 'Steel', 'structural steel'] },
    ],
    matching: { question: 'Match the welding process with its abbreviation', matchPairs: [{ left: 'SMAW', right: 'Stick/Manual metal arc' }, { left: 'GMAW', right: 'MIG welding' }, { left: 'GTAW', right: 'TIG welding' }] },
    ordering: { question: 'Arrange the welding preparation steps in order', correctOrder: ['Inspect base metal', 'Clean joint area', 'Set up equipment', 'Tack weld', 'Complete weld passes', 'Visual inspection'] },
    shortAnswer: { question: 'Name three common weld defects detectable by visual inspection.', correctAnswer: 'Undercut, porosity, incomplete fusion', acceptableAnswers: ['undercut', 'porosity', 'crack', 'spatter', 'incomplete fusion', 'overlap', 'burn-through'] },
    essay: { question: 'Explain the procedure for qualifying a weld per AWS D1.1, including preparation, execution, and testing requirements.', essayRubric: 'WPS;joint preparation;preheat;technique;visual inspection;NDT;bend test;tensile test' },
  },
  plumber: {
    mcqs: [
      { question: 'What is the standard fall for a 110mm soil pipe?', options: ['1:10', '1:40', '1:80', '1:200'], correctOption: 1 },
      { question: 'Which fitting allows change of direction in copper pipe?', options: ['Coupling', 'Elbow', 'Tee', 'Reducer'], correctOption: 1 },
      { question: 'What is the minimum pressure test duration for a hot water system?', options: ['10 mins', '30 mins', '1 hour', '2 hours'], correctOption: 1 },
      { question: 'What type of solder is required for potable water systems?', options: ['Lead solder', 'Lead-free solder', 'Silver solder', 'Acid-core solder'], correctOption: 1 },
    ],
    trueFalse: [
      { question: 'PTFE tape should be wrapped clockwise when facing the thread end.', correctAnswer: 'true' },
      { question: 'Copper pipes can be directly connected to galvanized steel without any isolation.', correctAnswer: 'false' },
    ],
    fillBlank: [
      { question: 'The minimum trap seal depth for a wash basin is ___ mm.', correctAnswer: '75', acceptableAnswers: ['75', '75mm'] },
      { question: 'Hot water storage temperature should be at least ___ °C to prevent Legionella.', correctAnswer: '60', acceptableAnswers: ['60', '60°C', '60 degrees'] },
    ],
    matching: { question: 'Match the pipe material with its common application', matchPairs: [{ left: 'Copper', right: 'Hot/cold water supply' }, { left: 'uPVC', right: 'Waste and soil drainage' }, { left: 'MDPE', right: 'Underground water mains' }] },
    ordering: { question: 'Arrange the pipe soldering steps in order', correctOrder: ['Cut pipe square', 'Deburr and clean', 'Apply flux', 'Assemble joint', 'Apply heat and solder', 'Wipe and inspect'] },
    shortAnswer: { question: 'Name three methods of joining copper pipes.', correctAnswer: 'Soldering, compression fitting, push-fit', acceptableAnswers: ['solder', 'compression', 'push-fit', 'press-fit', 'brazing', 'capillary'] },
    essay: { question: 'Describe the procedure for pressure testing a newly installed hot and cold water system, including preparation, test method, and acceptance criteria.', essayRubric: 'fill system;remove air;connect pump;raise pressure;hold period;check drops;inspect joints;record results' },
  },
  hvac_technician: {
    mcqs: [
      { question: 'What refrigerant is commonly used in modern split AC systems?', options: ['R22', 'R410A', 'R134a', 'R12'], correctOption: 1 },
      { question: 'What does SEER stand for?', options: ['System Energy Efficiency Ratio', 'Seasonal Energy Efficiency Ratio', 'Standard Energy Evaluation Rating', 'System Equipment Efficiency Rate'], correctOption: 1 },
      { question: 'What is the purpose of a thermostatic expansion valve?', options: ['Compress refrigerant', 'Regulate refrigerant flow', 'Remove moisture', 'Filter particles'], correctOption: 1 },
      { question: 'What indicates a refrigerant leak in a system?', options: ['High suction pressure', 'Low superheat', 'Oil stains at joints', 'All of the above'], correctOption: 2 },
    ],
    trueFalse: [
      { question: 'Refrigerant must never be vented to the atmosphere under environmental regulations.', correctAnswer: 'true' },
      { question: 'Vacuum pumps remove only air from the refrigeration system, not moisture.', correctAnswer: 'false' },
    ],
    fillBlank: [
      { question: 'The standard vacuum level for evacuation is ___ microns or lower.', correctAnswer: '500', acceptableAnswers: ['500', '500 microns'] },
      { question: 'R410A operates at approximately ___% higher pressure than R22.', correctAnswer: '60', acceptableAnswers: ['60', '50-60', '60%'] },
    ],
    matching: { question: 'Match the HVAC component with its function', matchPairs: [{ left: 'Compressor', right: 'Pressurizes refrigerant' }, { left: 'Condenser', right: 'Rejects heat outdoors' }, { left: 'Evaporator', right: 'Absorbs heat indoors' }] },
    ordering: { question: 'Arrange the AC installation commissioning steps', correctOrder: ['Mount indoor/outdoor units', 'Connect refrigerant lines', 'Evacuate system', 'Charge refrigerant', 'Test operation', 'Record readings'] },
    shortAnswer: { question: 'Name three signs of low refrigerant charge.', correctAnswer: 'Low suction pressure, warm air output, ice on evaporator', acceptableAnswers: ['low pressure', 'warm air', 'ice', 'frost', 'short cycling', 'high superheat'] },
    essay: { question: 'Describe the complete procedure for commissioning a split AC system, from installation to handover.', essayRubric: 'mounting;piping;brazing;pressure test;evacuation;charging;electrical check;performance test;documentation' },
  },
  _default: {
    mcqs: [
      { question: 'What is the primary purpose of a risk assessment?', options: ['Save money', 'Identify hazards', 'Speed up work', 'Reduce staff'], correctOption: 1 },
      { question: 'Which PPE is mandatory on all construction sites?', options: ['Ear plugs', 'Safety goggles', 'Hard hat and safety boots', 'Knee pads'], correctOption: 2 },
      { question: 'What should you do first when arriving at a new worksite?', options: ['Start working', 'Sign the register', 'Attend safety induction', 'Find the canteen'], correctOption: 2 },
      { question: 'How often should tools be inspected?', options: ['Monthly', 'Before each use', 'Annually', 'When broken'], correctOption: 1 },
    ],
    trueFalse: [
      { question: 'PPE is the first line of defense against workplace hazards.', correctAnswer: 'false' },
      { question: 'All workers must receive site-specific safety induction before starting work.', correctAnswer: 'true' },
    ],
    fillBlank: [
      { question: 'A near-miss should be reported using the site ___ system.', correctAnswer: 'incident reporting', acceptableAnswers: ['incident reporting', 'reporting', 'incident report'] },
      { question: 'The hierarchy of controls starts with ___ as the most effective measure.', correctAnswer: 'elimination', acceptableAnswers: ['elimination', 'eliminate'] },
    ],
    matching: { question: 'Match the hazard type with the control measure', matchPairs: [{ left: 'Noise', right: 'Ear protection' }, { left: 'Dust', right: 'Respiratory mask' }, { left: 'Heights', right: 'Fall protection harness' }] },
    ordering: { question: 'Arrange the hierarchy of controls from most to least effective', correctOrder: ['Elimination', 'Substitution', 'Engineering controls', 'Administrative controls', 'PPE'] },
    shortAnswer: { question: 'Name three types of fire extinguisher and their uses.', correctAnswer: 'Water (paper/wood), CO2 (electrical), Powder (liquid/gas)', acceptableAnswers: ['water', 'CO2', 'foam', 'powder', 'dry chemical'] },
    essay: { question: 'Describe the steps you would take to conduct a risk assessment before starting work on site.', essayRubric: 'identify hazards;assess risk;control measures;record findings;review;communicate;PPE' },
  },
};

// Alias trades to their question banks
const TRADE_ALIASES = {
  carpenter: 'mason', auto_mechanic: '_default', auto_electrician: 'electrician',
  painter: 'mason', tiler: 'mason', steel_fixer: 'welder', scaffolder: 'mason',
  heavy_equipment_operator: '_default', crane_operator: '_default', rigger: '_default',
  pipe_fitter: 'plumber', sheet_metal_worker: 'welder', insulation_technician: 'hvac_technician',
  fire_alarm_technician: 'electrician', elevator_technician: 'electrician',
  solar_panel_installer: 'electrician', industrial_electrician: 'electrician',
  refrigeration_technician: 'hvac_technician', building_automation_technician: 'electrician',
  quantity_surveyor_assistant: '_default', safety_officer: '_default',
  construction_foreman: '_default', heavy_machinery_mechanic: '_default',
  concrete_technician: 'mason', landscape_technician: 'mason',
};

// ─── Knowledge Check Generator ───
function generateKnowledgeChecks(mod, competencyTargets, trade) {
  const skills = competencyTargets.map(ct => ct.skill);
  const modTitle = mod.title || '';
  const relevantSkill = findRelevantSkill(modTitle, skills) || skills[0];

  const checks = [];

  // Generate 2-3 questions relevant to the module topic
  if (mod.type === 'video') {
    checks.push({
      question: `What is the main objective of the topic "${modTitle}"?`,
      type: 'mcq',
      options: [
        `Understanding ${relevantSkill} fundamentals`,
        `Advanced ${relevantSkill} techniques`,
        `${relevantSkill} troubleshooting`,
        `${relevantSkill} certification requirements`,
      ],
      correctOption: 0,
      competencyTag: relevantSkill,
      explanation: `This module covers the fundamentals of ${relevantSkill}.`,
    });
    checks.push({
      question: `Safety procedures must always be followed when performing tasks related to ${relevantSkill}.`,
      type: 'true-false',
      correctAnswer: 'true',
      competencyTag: relevantSkill,
      explanation: 'Safety is paramount in all vocational work.',
    });
    if (skills.length > 1) {
      const altSkill = skills.find(s => s !== relevantSkill) || skills[0];
      checks.push({
        question: `The key safety requirement before starting ${modTitle.toLowerCase()} work is ___.`,
        type: 'fill-blank',
        correctAnswer: 'risk assessment',
        acceptableAnswers: ['risk assessment', 'safety check', 'hazard identification', 'PPE check'],
        competencyTag: altSkill,
        explanation: 'A risk assessment must be completed before starting any practical work.',
      });
    }
  } else if (mod.type === 'reading') {
    checks.push({
      question: `What is the primary learning outcome of "${modTitle}"?`,
      type: 'mcq',
      options: [
        `Apply ${relevantSkill} knowledge in practice`,
        `Memorize ${relevantSkill} theory only`,
        `Ignore ${relevantSkill} standards`,
        `Delegate ${relevantSkill} to others`,
      ],
      correctOption: 0,
      competencyTag: relevantSkill,
      explanation: `Reading materials build theoretical knowledge to be applied in practice.`,
    });
    checks.push({
      question: `Standards and regulations are optional guidelines in ${trade} work.`,
      type: 'true-false',
      correctAnswer: 'false',
      competencyTag: relevantSkill,
      explanation: 'Standards and regulations are mandatory requirements that must be followed.',
    });
  }

  return checks;
}

function findRelevantSkill(title, skills) {
  const titleLower = title.toLowerCase();
  for (const skill of skills) {
    const words = skill.toLowerCase().split(/\s+/);
    if (words.some(w => w.length > 3 && titleLower.includes(w))) return skill;
  }
  return null;
}

// ─── Rubric Template Generator ───
function generateRubricTemplate(mod, trade) {
  const tradeRubrics = TRADE_RUBRIC_TEMPLATES[trade] || TRADE_RUBRIC_TEMPLATES[TRADE_ALIASES[trade]] || TRADE_RUBRIC_TEMPLATES._default;

  if (mod.type === 'practical') {
    return tradeRubrics.practical || tradeRubrics._default;
  } else if (mod.type === 'assignment') {
    return tradeRubrics.assignment || [
      { criterion: 'Technical Accuracy', description: 'Correct application of trade knowledge and standards', maxScore: 4 },
      { criterion: 'Documentation Quality', description: 'Clear, well-structured written work', maxScore: 4 },
      { criterion: 'Problem Analysis', description: 'Identification and analysis of key issues', maxScore: 4 },
      { criterion: 'Recommendations', description: 'Practical and feasible recommendations', maxScore: 4 },
      { criterion: 'References & Standards', description: 'Correct citation of relevant standards', maxScore: 4 },
    ];
  }
  return tradeRubrics._default;
}

const TRADE_RUBRIC_TEMPLATES = {
  mason: {
    practical: [
      { criterion: 'Material Selection & Preparation', description: 'Correct brick/block and mortar selection, proper mixing', maxScore: 4 },
      { criterion: 'Setting Out & Alignment', description: 'Accurate setting out, level and plumb throughout', maxScore: 4 },
      { criterion: 'Bond Pattern & Jointing', description: 'Correct bond pattern, consistent 10mm joints', maxScore: 4 },
      { criterion: 'Safety Compliance', description: 'PPE worn, safe working practices, tidy workspace', maxScore: 4 },
      { criterion: 'Finish Quality', description: 'Clean faces, neat pointing, meets specification', maxScore: 4 },
    ],
  },
  electrician: {
    practical: [
      { criterion: 'Cable Selection & Routing', description: 'Correct cable type/size, neat routing and clipping', maxScore: 4 },
      { criterion: 'Connection Quality', description: 'Secure terminations, correct torque, no exposed copper', maxScore: 4 },
      { criterion: 'Safety Compliance', description: 'Safe isolation, LOTO, PPE, voltage testing', maxScore: 4 },
      { criterion: 'Testing & Verification', description: 'Correct test procedures, readings within limits', maxScore: 4 },
      { criterion: 'Code Compliance', description: 'Meets BS 7671 / local wiring regulations', maxScore: 4 },
    ],
  },
  welder: {
    practical: [
      { criterion: 'Joint Preparation', description: 'Correct bevel, gap, and cleanliness', maxScore: 4 },
      { criterion: 'Weld Quality', description: 'Correct profile, penetration, no visible defects', maxScore: 4 },
      { criterion: 'Technique & Control', description: 'Consistent travel speed, arc length, and heat input', maxScore: 4 },
      { criterion: 'Safety Compliance', description: 'PPE, ventilation, fire watch, hot work permit', maxScore: 4 },
      { criterion: 'Visual Inspection', description: 'Meets AWS D1.1 / relevant code acceptance criteria', maxScore: 4 },
    ],
  },
  plumber: {
    practical: [
      { criterion: 'Pipe Fitting & Assembly', description: 'Correct cutting, deburring, and assembly', maxScore: 4 },
      { criterion: 'Joint Quality', description: 'Leak-free joints, correct technique (solder/compression/push-fit)', maxScore: 4 },
      { criterion: 'Pressure Testing', description: 'Correct test procedure, no pressure drop', maxScore: 4 },
      { criterion: 'Safety Compliance', description: 'Hot work precautions, PPE, water hygiene', maxScore: 4 },
      { criterion: 'Code Compliance', description: 'Meets building regulations and water bylaws', maxScore: 4 },
    ],
  },
  hvac_technician: {
    practical: [
      { criterion: 'System Installation', description: 'Correct mounting, piping, and connections', maxScore: 4 },
      { criterion: 'Refrigerant Handling', description: 'Proper evacuation, charging, and leak checking', maxScore: 4 },
      { criterion: 'Electrical Connections', description: 'Correct wiring, controls, and safety devices', maxScore: 4 },
      { criterion: 'Testing & Commissioning', description: 'Performance verification, temperature/pressure readings', maxScore: 4 },
      { criterion: 'Safety & Environmental', description: 'F-gas compliance, PPE, proper recovery', maxScore: 4 },
    ],
  },
  _default: {
    practical: [
      { criterion: 'Technical Execution', description: 'Correct application of trade skills and techniques', maxScore: 4 },
      { criterion: 'Material Handling', description: 'Proper selection, preparation, and use of materials', maxScore: 4 },
      { criterion: 'Safety Compliance', description: 'PPE, hazard awareness, safe working practices', maxScore: 4 },
      { criterion: 'Quality Standards', description: 'Work meets relevant industry standards', maxScore: 4 },
      { criterion: 'Workspace Management', description: 'Clean, organized workspace, proper tool care', maxScore: 4 },
    ],
    _default: [
      { criterion: 'Technical Accuracy', description: 'Correct application of knowledge and skills', maxScore: 4 },
      { criterion: 'Safety Awareness', description: 'Demonstrates safety-first approach', maxScore: 4 },
      { criterion: 'Quality of Work', description: 'Meets specified standards and tolerances', maxScore: 4 },
      { criterion: 'Problem Solving', description: 'Ability to identify and resolve issues', maxScore: 4 },
    ],
  },
};

// ─── Main expansion function ───
function expandCurricula(filePath) {
  console.log(`Reading ${filePath}...`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(raw);

  const framework = data.framework || '';
  let totalQuizAdded = 0, totalKCAdded = 0, totalRubricAdded = 0;

  for (const curriculum of data.curricula) {
    const trade = curriculum.trade;
    const nqfLevel = curriculum.nqfLevel;
    const targets = curriculum.competencyTargets || [];

    // 1. Expand quiz bank 6 → 18
    const existingCount = (curriculum.quizBank || []).length;
    if (existingCount < 18) {
      const extra = generateExtraQuizQuestions(trade, targets, nqfLevel, framework);
      curriculum.quizBank = [...(curriculum.quizBank || []), ...extra];
      totalQuizAdded += extra.length;
    }

    // 2 & 3. Process modules
    for (const mod of (curriculum.modules || [])) {
      // Knowledge checks for video/reading
      if ((mod.type === 'video' || mod.type === 'reading') && !mod.knowledgeChecks?.length) {
        mod.knowledgeChecks = generateKnowledgeChecks(mod, targets, trade);
        mod.knowledgeCheckRequired = true;
        mod.knowledgeCheckPassMark = 70;
        totalKCAdded += mod.knowledgeChecks.length;
      }

      // Rubric templates for practical/assignment
      if ((mod.type === 'practical' || mod.type === 'assignment') && !mod.rubricTemplate?.length) {
        mod.rubricTemplate = generateRubricTemplate(mod, trade);
        mod.rubricRequired = true;
        totalRubricAdded += mod.rubricTemplate.length;
      }
    }
  }

  // Write back
  const output = JSON.stringify(data, null, 2);
  fs.writeFileSync(filePath, output, 'utf8');

  const lines = output.split('\n').length;
  console.log(`  Written: ${lines} lines (${(Buffer.byteLength(output) / 1024).toFixed(0)} KB)`);
  console.log(`  Quiz questions added: ${totalQuizAdded}`);
  console.log(`  Knowledge checks added: ${totalKCAdded}`);
  console.log(`  Rubric criteria added: ${totalRubricAdded}`);
}

// ─── Run ───
const dataDir = path.join(__dirname, '..', 'data');
expandCurricula(path.join(dataDir, 'navttc-curricula.json'));
expandCurricula(path.join(dataDir, 'gulf-curricula.json'));
console.log('\nDone!');
