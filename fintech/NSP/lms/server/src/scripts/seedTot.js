/**
 * Seed / upsert the "Training of Trainers on Zigzag Brick Kiln Operation" programme.
 * Idempotent: matched by title. Run inside the server container:
 *   node src/scripts/seedTot.js
 */
import mongoose from 'mongoose';
import env from '../config/env.js';
import Training from '../models/Training.js';

const TITLE = 'Training of Trainers on Zigzag Brick Kiln Operation';

const wrap = (html) => `<div style="line-height:1.6">${html}</div>`;

const modules = [
  {
    title: 'Welcome and Programme Overview',
    type: 'reading', order: 1, duration: 15,
    content: wrap(`
      <h2>Welcome</h2>
      <p>This four-day Training of Trainers (ToT) prepares master trainers to deliver competency-based training on
      zigzag brick kiln operation. It is organised under the ILO Just Transition Project with SBBWU Peshawar,
      KP-TEVTA, NAVTTC, GIZ, WHH, EPA KP, the Brick Kiln Owners Association and Working Women.</p>
      <h3>Dates and venues</h3>
      <ul>
        <li><b>Day 1 (21 July 2026)</b> — SBBWU Peshawar: Climate, Green Finance and Occupational Safety</li>
        <li><b>Day 2 (22 July 2026)</b> — SBBWU Peshawar: Skills Development and the Brick Kiln Sector</li>
        <li><b>Day 3 (23 July 2026)</b> — Hassan Abdal: Field visit to an operating zigzag brick kiln</li>
        <li><b>Day 4 (24 July 2026)</b> — Serena Hotel Peshawar: Closing and certification</li>
      </ul>
      <h3>What you will be able to do</h3>
      <ul>
        <li>Explain the climate, policy and green-finance context of the brick sector</li>
        <li>Apply occupational safety, health and emergency-response practices</li>
        <li>Use competency-based training, recognition of prior learning and green-skills concepts</li>
        <li>Describe the zigzag kiln, its conversion economics and the compliance mandate</li>
        <li>Observe and explain an operating kiln, and train others to do the same</li>
      </ul>
      <p><b>How to complete:</b> work through each session below, then attend the field visit and pass the
      final <i>Field Visit Capacity Quiz</i>. Passing the quiz issues your verified certificate automatically.</p>
    `),
  },
  {
    title: 'Day 1 · Climate Change, Policies and Green Finance',
    type: 'reading', order: 2, duration: 30,
    content: wrap(`
      <h2>Climate, policies and green finance for the brick sector</h2>
      <p>Pakistan is among the countries most exposed to climate change while contributing little to global emissions.
      The brick sector is a significant source of air pollution and a priority for greening.</p>
      <ul>
        <li>Global and national climate context; the UNFCCC and the Paris Agreement</li>
        <li>Pakistan's Climate Change Act 2017 and the updated Nationally Determined Contributions</li>
        <li>The local mandate: the EPA KP order requiring conversion of fixed-chimney kilns to zigzag</li>
        <li>Green-finance pathways: State Bank SME green finance (up to PKR 2.5 million at 6%) and ILO cost-sharing grants</li>
      </ul>
      <p>A short exercise and group activity connect these concepts to the trainer's own district.</p>
    `),
  },
  {
    title: 'Day 1 · Occupational Safety and Health, and Emergency Response',
    type: 'reading', order: 3, duration: 30,
    content: wrap(`
      <h2>Occupational safety and health</h2>
      <p>Safety and health at the kiln are a production investment, not a cost. Documented field data show that only a
      small share of workers have access to first aid, safe water or accident prevention.</p>
      <ul>
        <li>Major hazards: heat stroke (critical, can be fatal), dust and smoke, burns, falls and manual handling</li>
        <li>Controls: rest and hydration cycles, shade, dust control, N95 masks and zigzag conversion</li>
        <li>Personal protective equipment and its modest cost against injuries prevented</li>
        <li>Emergency response and first aid; a live demonstration with Rescue 1122</li>
      </ul>
      <p>OSH training has been shown to cut heat-stress incidents by up to 60 percent.</p>
    `),
  },
  {
    title: 'Day 2 · Competency-Based Training, RPL and Curriculum',
    type: 'reading', order: 4, duration: 30,
    content: wrap(`
      <h2>CBT, recognition of prior learning and curriculum</h2>
      <ul>
        <li>Competency-based training assesses what a person can do against a defined standard, aligned to the NVQF
        (for example Moulder Helper at Level 2 and Fireman at Level 3)</li>
        <li>Recognition of prior learning gives formal credit for skills workers already have</li>
        <li>The skills gap, not the technology, is the main barrier to conversion in KP: about 70 to 80 percent of the
        brick workforce is illiterate and only about 2 percent hold any certification</li>
        <li>Trained supervisors deliver 15 to 22 percent better fuel efficiency and 18 to 25 percent fewer rejects</li>
        <li>The role of donors as delivery partners, and issues in delivering training below and above Level 5</li>
      </ul>
    `),
  },
  {
    title: 'Day 2 · Green Skills and Transversal Skills',
    type: 'reading', order: 5, duration: 25,
    content: wrap(`
      <h2>Green skills, greening of skills and transversal skills</h2>
      <ul>
        <li>What green skills are, and how existing trades are "greened" rather than replaced</li>
        <li>Transversal skills: safety mindset, resource efficiency, teamwork, communication and problem solving</li>
        <li>The seven hallmarks of a greened skill applied to brick making</li>
        <li>How trainers embed green and transversal skills into everyday kiln work</li>
      </ul>
    `),
  },
  {
    title: 'Day 2 · The Brick Kiln Sector and Zigzag Conversion',
    type: 'reading', order: 6, duration: 35,
    content: wrap(`
      <h2>The brick kiln sector and zigzag technology</h2>
      <p><b>Sector at a glance:</b> about 20,000 kilns in Pakistan, 4.5 million workers and 82.5 billion bricks a year.
      KP has roughly 2,000 kilns; Peshawar alone about 300.</p>
      <h3>Verified performance of zigzag (peer-reviewed, 2025)</h3>
      <ul>
        <li>Coal use about 20 percent less (up to 50 percent with good coal)</li>
        <li>Carbon monoxide about 35 percent less; carbon dioxide about 26 percent less</li>
        <li>Black carbon 30 to 55 percent less; fine particulate 20 to 40 percent less per brick</li>
      </ul>
      <h3>The financial and compliance case</h3>
      <ul>
        <li>A medium kiln saves roughly PKR 3 to 10 million a year in coal</li>
        <li>Retrofit cost PKR 400,000 to 700,000, recovered within one to two firing seasons</li>
        <li>The EPA KP order makes conversion a legal requirement; the main barrier is skills</li>
      </ul>
    `),
  },
  {
    title: 'Day 3 · Field Visit and Capacity Checklist',
    type: 'reading', order: 7, duration: 30,
    content: wrap(`
      <h2>Field visit to an operating zigzag kiln (Hassan Abdal)</h2>
      <p>Observe the kiln in operation and complete the capacity checklist. You will confirm you can explain each
      process to your own workers.</p>
      <h3>What to observe</h3>
      <ul>
        <li>The overall structure and the path the hot gases follow</li>
        <li>The zigzag stacking pattern and the air channels it forms</li>
        <li>The induced-draught fan and how airflow is controlled</li>
        <li>Fuel feeding and signs of complete combustion (flame colour, low smoke)</li>
        <li>Firing temperature (target 950 to 1,050 °C) and quality tests (ring test, shape check)</li>
        <li>Use of protective equipment and dust, smoke and heat controls</li>
      </ul>
      <p>After the visit, complete the <b>Final Assessment · Field Visit Capacity Quiz</b> from home.</p>
    `),
  },
  {
    title: 'Day 4 · Closing and Certification',
    type: 'reading', order: 8, duration: 10,
    content: wrap(`
      <h2>Closing and certification</h2>
      <p>The programme closes with a ceremony and the award of certificates at Serena Hotel Peshawar. Your verified
      digital certificate is issued automatically once you pass the final quiz, and can be downloaded and verified
      online at any time through the QR code and verification link on the certificate.</p>
    `),
  },
  {
    title: 'Day 3 · Field Visit Survey and Observation Pack',
    type: 'reading', order: 8.5, duration: 25,
    description: 'Complete this observation survey during the Day 3 field visit, before taking the Field Visit Capacity Quiz.',
    isSurvey: true,
    publicSurvey: true,
    surveyQuestions: [
      { section: 'Station 1 — Stacking & Airflow', prompt: 'Stacking pattern', options: ['Even & open', 'Uneven / blocked'] },
      { section: 'Station 1 — Stacking & Airflow', prompt: 'Air channels continuous', options: ['Yes', 'Mostly', 'No'] },
      { section: 'Station 1 — Stacking & Airflow', prompt: 'Stack stability', options: ['Stable & straight', 'Leaning / gaps'] },
      { section: 'Station 1 — Stacking & Airflow', prompt: 'Brick colour (firing)', options: ['Uniform', 'Mixed / patchy'] },
      { section: 'Station 2 — Fan, Combustion & Fuel', prompt: 'Induced-draught fan running', options: ['Yes', 'No'] },
      { section: 'Station 2 — Fan, Combustion & Fuel', prompt: 'Draft strength', options: ['Strong', 'Steady', 'Weak'] },
      { section: 'Station 2 — Fan, Combustion & Fuel', prompt: 'Smoke colour at chimney', options: ['Light / clean', 'Grey', 'Black'] },
      { section: 'Station 2 — Fan, Combustion & Fuel', prompt: 'Fuel feeding', options: ['Regular', 'Irregular'] },
      { section: 'Station 2 — Fan, Combustion & Fuel', prompt: 'Temperature / firing control evident', options: ['Yes', 'No'] },
      { section: 'Station 3 — Quality, OSH & Hands-on', prompt: 'Ring test', options: ['Clear ring', 'Dull thud'] },
      { section: 'Station 3 — Quality, OSH & Hands-on', prompt: 'Visible defects (tick all seen)', options: ['Cracks', 'Warping', 'Under-fired', 'None'], multi: true },
      { section: 'Station 3 — Quality, OSH & Hands-on', prompt: 'Workers wearing PPE', options: ['Most', 'Some', 'None'] },
      { section: 'Station 3 — Quality, OSH & Hands-on', prompt: 'Hazards seen (tick all)', options: ['Dust', 'Smoke', 'Heat', 'Child labour', 'Other'], multi: true },
      { section: 'Wrap-up', prompt: 'One efficiency issue you noticed', text: true },
      { section: 'Wrap-up', prompt: 'One OSH fix needed', text: true },
      { section: 'Wrap-up', prompt: 'Top 3 things you learned', text: true },
      { section: 'Wrap-up', prompt: 'One change you will take to your own kiln / training', text: true },
    ],
    content: wrap(`
      <h2>Field Visit — Activity &amp; Observation Pack</h2>
      <p><b>Day 3 · Hassan Abdal Brick Kiln Cluster.</b> Built for a hot-weather visit: minimise time on the
      kiln floor, capture by ticking (not writing), and recover in shade. Complete this pack during the visit,
      then take the <i>Field Visit Capacity Quiz</i>.</p>

      <h3>1. Learning objectives</h3>
      <ul>
        <li>Observe operational practices in a real, working zigzag kiln</li>
        <li>Analyse airflow, combustion and fuel-feeding on a live setting</li>
        <li>Assess workplace safety (OSH) against ILO / KP standards</li>
        <li>Inspect brick quality and identify common defects (ring test, visual)</li>
        <li>Document operational strengths and improvement opportunities</li>
        <li>Link observations to the NVQF tasks (L2 Moulder Helper, L3 Fireman) you will train and assess</li>
      </ul>

      <h3>2. The 8-point heat protocol</h3>
      <ul>
        <li><b>Front-load in shade</b> — all explanation happens before entering the kiln; field time is pure observation.</li>
        <li><b>Time-box hard</b> — 3 stations × ~12 minutes; a marshal calls each rotation and the retreat.</li>
        <li><b>Tick, don't write</b> — the sheet is mostly tick-boxes; each person captures only their assigned focus.</li>
        <li><b>Photograph the record</b> — one photographer per group; annotate later in shade.</li>
        <li><b>Divide roles</b> — recorder, photographer, lead questioner.</li>
        <li><b>Shade + water station</b> — a shaded rest point with water/electrolyte at the kiln edge.</li>
        <li><b>Watch the WBGT</b> — a safety marshal tracks heat, enforces hydration, can call an early retreat.</li>
        <li><b>Debrief in shade</b> — never debrief on the kiln floor.</li>
      </ul>

      <h3>3. The three stations — what to observe</h3>
      <ul>
        <li><b>Station 1 — Stacking &amp; airflow:</b> zigzag pattern and channel continuity, stack stability, air-path maintenance, brick-colour uniformity.</li>
        <li><b>Station 2 — Fan, combustion &amp; fuel:</b> induced-draught fan and draft strength, chimney smoke colour, regular vs irregular fuel feeding, firing-zone control.</li>
        <li><b>Station 3 — Quality, OSH &amp; hands-on:</b> ring test and visible defects, worker PPE and hazards (dust, smoke, heat, child labour), fuel/ash handling; correct a small stack section.</li>
      </ul>

      <h3>4. Rapid field observation sheet</h3>
      <p><b>Print one per participant. Tick what you see</b> on the kiln floor; fill the wrap-up later in shade.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead><tr style="background:#1A4D2E;color:#fff">
          <th style="padding:6px;text-align:left">Observation</th><th style="padding:6px;text-align:left">Tick what you see</th></tr></thead>
        <tbody>
          <tr><td style="padding:6px;border:1px solid #ddd">Stacking pattern</td><td style="padding:6px;border:1px solid #ddd">☐ Even &amp; open&nbsp;&nbsp;&nbsp;☐ Uneven / blocked</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd">Air channels continuous</td><td style="padding:6px;border:1px solid #ddd">☐ Yes&nbsp;&nbsp;&nbsp;☐ Mostly&nbsp;&nbsp;&nbsp;☐ No</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd">Stack stability</td><td style="padding:6px;border:1px solid #ddd">☐ Stable &amp; straight&nbsp;&nbsp;&nbsp;☐ Leaning / gaps</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd">Brick colour (firing)</td><td style="padding:6px;border:1px solid #ddd">☐ Uniform&nbsp;&nbsp;&nbsp;☐ Mixed / patchy</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd">Induced-draught fan running</td><td style="padding:6px;border:1px solid #ddd">☐ Yes&nbsp;&nbsp;&nbsp;☐ No</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd">Draft strength</td><td style="padding:6px;border:1px solid #ddd">☐ Strong&nbsp;&nbsp;&nbsp;☐ Steady&nbsp;&nbsp;&nbsp;☐ Weak</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd">Smoke colour at chimney</td><td style="padding:6px;border:1px solid #ddd">☐ Light / clean&nbsp;&nbsp;&nbsp;☐ Grey&nbsp;&nbsp;&nbsp;☐ Black</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd">Fuel feeding</td><td style="padding:6px;border:1px solid #ddd">☐ Regular&nbsp;&nbsp;&nbsp;☐ Irregular</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd">Ring test</td><td style="padding:6px;border:1px solid #ddd">☐ Clear ring&nbsp;&nbsp;&nbsp;☐ Dull thud</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd">Visible defects</td><td style="padding:6px;border:1px solid #ddd">☐ Cracks&nbsp;&nbsp;☐ Warping&nbsp;&nbsp;☐ Under-fired&nbsp;&nbsp;☐ None</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd">Workers wearing PPE</td><td style="padding:6px;border:1px solid #ddd">☐ Most&nbsp;&nbsp;&nbsp;☐ Some&nbsp;&nbsp;&nbsp;☐ None</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd">Hazards seen</td><td style="padding:6px;border:1px solid #ddd">☐ Dust&nbsp;&nbsp;☐ Smoke&nbsp;&nbsp;☐ Heat&nbsp;&nbsp;☐ Child labour&nbsp;&nbsp;☐ Other</td></tr>
        </tbody>
      </table>

      <h3>5. Wrap-up (fill in shade, after retreat)</h3>
      <ul>
        <li>Top 3 things I learned</li>
        <li>One question for the operator</li>
        <li>Photo reference numbers</li>
        <li>One change I will take to my own kiln / training</li>
      </ul>

      <h3>6. Heat-safety kit</h3>
      <p>Clipboard/tablet + this sheet (per participant) · drinking water + electrolytes · shaded canopy · first-aid kit ·
      WBGT meter or thermometer · dust masks, gloves, eye protection, sturdy footwear · phone/camera per group · ORS sachets.</p>

      <h3>7. Post-visit debrief (in shade)</h3>
      <ul>
        <li><b>Consolidate</b> — pool group sheets onto one flip chart: good practices vs improvement points.</li>
        <li><b>Compare</b> — groups present; map observations to stacking / airflow / fan / OSH / quality.</li>
        <li><b>Connect</b> — tie each finding to an NVQF task and a training / assessment point.</li>
        <li><b>Commit</b> — write one change you will take to your own kiln or training.</li>
      </ul>
      <p><b>Modern skills + cleaner technology = efficient, safe and profitable brick kilns.</b></p>
    `),
  },
  {
    title: 'Day 4 · Trainer Assessment',
    type: 'reading', order: 8.7, duration: 5,
    isTrainerAssessment: true,
    description: 'Rate each trainer on the five criteria. Anonymous feedback used to improve future trainings.',
    content: wrap(`
      <h2>Trainer Assessment</h2>
      <p>Please give <b>anonymous</b> feedback on each trainer. For every trainer, rate the five criteria from
      <b>1 (Strongly disagree)</b> to <b>5 (Strongly agree)</b>.</p>
      <p><b>Scale:</b> 1 = Strongly disagree &nbsp;·&nbsp; 2 = Disagree &nbsp;·&nbsp; 3 = Neutral &nbsp;·&nbsp; 4 = Agree &nbsp;·&nbsp; 5 = Strongly agree</p>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#0E2A47;color:#fff">
          <th style="padding:6px;text-align:left">Trainer &amp; Session</th>
          <th style="padding:6px">Clarity</th><th style="padding:6px">Subject knowledge</th>
          <th style="padding:6px">Time-keeping</th><th style="padding:6px">Examples &amp; visuals</th>
          <th style="padding:6px">Engagement</th></tr></thead>
        <tbody>
          <tr><td style="padding:6px;border:1px solid #ddd"><b>1. Prof. Dr. Yasir Kamal</b><br><span style="color:#666">Climate Change and Green Skills</span></td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd"><b>2. Haider Khan</b><br><span style="color:#666">Occupational Safety and Health (OSH)</span></td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd"><b>3. Malik Riaz</b><br><span style="color:#666">Practical OSH</span></td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd"><b>4. Mr. Hamid Fawad</b><br><span style="color:#666">Quality Controls in Brick Kiln</span></td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd"><b>5. Maqsood Bacha</b><br><span style="color:#666">DACUM &amp; Curricula Development</span></td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd"><b>6. Mr. Tahir Khan</b><br><span style="color:#666">CBT &amp; TVET Reforms</span></td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td></tr>
          <tr><td style="padding:6px;border:1px solid #ddd"><b>7. Mr. Hamid Fawad</b><br><span style="color:#666">Practical on Brick Kiln</span></td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td style="padding:6px;border:1px solid #ddd;text-align:center">1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td></tr>
        </tbody>
      </table>
      <p style="font-size:13px;color:#555"><b>Criteria:</b> <b>Clarity</b> — explained clearly and simply · <b>Subject knowledge</b> — knew the topic, answered questions ·
      <b>Time-keeping</b> — kept to time, stayed on topic · <b>Examples &amp; visuals</b> — aided understanding · <b>Engagement</b> — engaging, encouraged participation.</p>
      <p style="font-size:13px;color:#555"><b>Scoring:</b> per trainer, average the five ratings × 20 = score out of 100; averaged across all participants for an objective ranking.
      Please also note one thing any trainer could improve.</p>
    `),
  },
  // --- Video modules (Google Drive embeds) ---------------------------------
  {
    title: 'Video · Occupational Safety and Health at Brick Kilns',
    type: 'video', order: 3.5, duration: 12,
    videoUrl: 'https://drive.google.com/file/d/1asZ23WCcUz6nVUYpLVcQcWXlcHkeTOwZ/preview',
    description: 'Occupational safety and health practices at brick kilns. Watch alongside the Day 1 OSH session.',
  },
  {
    title: 'Video · Zigzag Brick Kiln Technology — Step by Step',
    type: 'video', order: 6.1, duration: 18,
    videoUrl: 'https://drive.google.com/file/d/1s5St4WYxHv7Fcc5ac33B8f3t4zfe9y1-/preview',
    description: 'The overall zigzag brick kiln technology and its step-by-step firing process.',
  },
  {
    title: 'Video · Zigzag versus Conventional Brick Kiln',
    type: 'video', order: 6.2, duration: 10,
    videoUrl: 'https://drive.google.com/file/d/1GpyBJX3QOScQ7iRSrKy3hklpXYJls3mo/preview',
    description: 'A comparison of zigzag technology against conventional fixed-chimney kilns.',
  },
  {
    title: 'Video · Converting a Conventional Kiln to Zigzag',
    type: 'video', order: 6.3, duration: 12,
    videoUrl: 'https://drive.google.com/file/d/1AkIFpffutzxSAMKMZLZs6D36H_qf8x1O/preview',
    description: 'The process of converting a conventional fixed-chimney kiln into a zigzag kiln.',
  },
];

// Pre/Post knowledge assessment — the SAME 15 questions are taken as a blind
// pre-test (baseline) at the start and again as a post-test at the end, to
// measure learning gain across the whole programme.
const PREPOST = [
  ['Which international agreement commits countries to limit global warming to well below 2 degrees Celsius?',
    ['The Paris Agreement', 'The Montreal Protocol', 'The Geneva Convention', 'The Factories Act'], 0],
  ["Pakistan's principal national climate law is:",
    ['The Forest Act 1927', 'The Climate Change Act 2017', 'The Factories Act 1934', 'There is none'], 1],
  ['Green skills are best described as:',
    ['Skills only for planting trees', 'Computer skills only', 'The abilities needed to work in resource-efficient, low-carbon ways', 'Skills unrelated to any trade'], 2],
  ['Greening an existing trade means:',
    ['Adding resource-efficient, low-emission practices to the existing work', 'Replacing the trade entirely', 'Stopping the work', 'Only changing the job title'], 0],
  ['Transversal (core) skills include:',
    ['Only machine operation', 'Only reading and writing', 'Communication, teamwork, safety awareness and problem solving', 'None of these'], 2],
  ['In competency-based training, a learner is judged mainly by:',
    ['How long they attended', 'What they can actually do against a defined standard', 'Their age', 'Memorised theory only'], 1],
  ['Recognition of Prior Learning (RPL) is used to:',
    ['Give formal credit for skills already gained on the job', "Ignore a worker's experience", 'Test literacy only', 'Replace all training'], 0],
  ['A well run zigzag kiln reduces coal use by roughly:',
    ['No reduction', 'About 90 percent', 'About 20 percent', 'It uses more coal'], 2],
  ['Compared with a traditional kiln, a zigzag kiln produces:',
    ['More smoke and particulates', 'Less smoke and lower PM2.5 emissions', 'The same emissions', 'No bricks'], 1],
  ['A major occupational health risk at brick kilns is:',
    ['Dust, smoke and heat exposure', 'Excessive air conditioning', 'Too much rest', 'None'], 0],
  ['The most important protective equipment against kiln dust and smoke is:',
    ['Sunglasses', 'Sandals', 'A raincoat', 'A dust mask or respirator'], 3],
  ['Heat stress in workers is best managed by:',
    ['Ignoring the early signs', 'Providing water, shade and rest cycles', 'Asking workers to work faster', 'Removing all breaks'], 1],
  ["Under KP's current regulations, traditional fixed-chimney kilns must:",
    ['Continue unchanged', 'Increase coal use', 'Convert to zigzag technology', 'Close the whole sector'], 2],
  ['The competency qualifications for kiln work align to trades such as:',
    ['Moulder Helper (Level 2) and Fireman (Level 3)', 'Electrician and plumber', 'Welder and carpenter', 'Driver and guard'], 0],
  ['The main purpose of a pre-test and a post-test in training is to:',
    ['Fill time', 'Rank workers publicly', 'Measure the learning gained from the training', 'Replace the certificate'], 2],
].map(([question, options, correctOption]) => ({
  question, type: 'mcq', options, correctOption, points: 1, difficulty: 'medium',
}));

modules.splice(1, 0, {
  title: 'Pre and Post Training Assessment',
  type: 'quiz', order: 2, duration: 15,
  isPrePost: true,
  description: 'Fifteen questions taken as a baseline pre-test at the start and again as a post-test at the end, to measure your learning gain. Pass mark 70 percent.',
  quizQuestions: PREPOST,
});

const QUIZ = [
  ['The main design feature that makes a kiln a zigzag kiln is that:',
    ['It uses electricity instead of coal', 'The bricks are stacked so the hot gases travel a long zigzag path', 'It has no chimney at all', 'The bricks are fired in the open air'], 1],
  ['The zigzag path improves efficiency mainly because it:',
    ['Cools the bricks more quickly', 'Gives the hot gases more contact time with the bricks for better heat transfer', 'Reduces the number of bricks fired', 'Removes the need to feed fuel'], 1],
  ['In an induced draught zigzag kiln, the fan is used to:',
    ['Cool the workers', 'Pull air through the setting to control airflow and combustion', 'Press the green bricks', 'Mix the clay'], 1],
  ['Correct brick stacking matters in a zigzag kiln because:',
    ['It only makes the kiln look neat', 'The stacking itself forms the air channels that guide the hot gases', 'It reduces the number of firemen needed', 'It has no real effect on firing'], 1],
  ['Good airflow and complete combustion in a zigzag kiln lead to:',
    ['More smoke and higher coal use', 'Weaker bricks', 'Lower fuel use, reduced emissions and better quality bricks', 'No change at all'], 2],
  ['Compared with a traditional kiln, a well run zigzag kiln can save coal by about:',
    ['No saving', 'Twenty percent or more', 'It always uses more coal', 'One or two bricks'], 1],
  ['When a fired brick is struck, a clear metallic ring usually indicates:',
    ['An under fired brick', 'A wet brick', 'A well fired brick', 'A broken brick'], 2],
  ['A sign of good quality, well fired bricks is:',
    ['Uneven colour and many cracks', 'Soft and crumbly texture', 'High water absorption', 'Sharp edges, uniform colour and a clear ring'], 3],
  ['Feeding fuel little and often into the firing zone helps to:',
    ['Increase smoke', 'Maintain a steady temperature and complete combustion', 'Cool the kiln down', 'Lower the brick quality'], 1],
  ['Uneven firing, with hot and cold spots, is commonly caused by:',
    ['Correct stacking', 'Blocked or poorly formed air channels', 'Using an induced draught fan', 'Feeding fuel evenly'], 1],
  ['A major environmental benefit of zigzag technology is:',
    ['More particulate emissions', 'Reduced smoke and PM2.5 emissions', 'Higher carbon output', 'No change in emissions'], 1],
  ['The most important protective equipment against dust and smoke at a kiln is:',
    ['Sunglasses', 'A dust mask or respirator', 'A raincoat', 'Open sandals'], 1],
  ['Heat stress among kiln workers is best managed by:',
    ['Ignoring the early signs', 'Providing water, shade and rest cycles and watching for warning signs', 'Asking workers to work faster', 'Removing all breaks'], 1],
  ['Converting a traditional kiln to zigzag mainly requires:',
    ['Demolishing the whole kiln', 'A revised stacking layout, an induced draught fan, and trained firemen and stackers', 'Only a taller chimney', 'No changes at all'], 1],
  ['The competency based qualifications in this programme are aligned to the trades of:',
    ['Electrician and plumber', 'Moulder Helper at Level 2 and Fireman at Level 3', 'Welder and carpenter', 'Driver and security guard'], 1],
  ['Watching flame colour and smoke during firing helps the operator to:',
    ['Decorate the kiln', 'Judge whether the combustion and airflow are correct', 'Measure the size of the bricks', 'Count the bricks'], 1],
  ['The capacity checklist used during the field visit is meant to help participants:',
    ['Record attendance only', 'Observe and verify the zigzag processes and the safety practices', 'Arrange the lunch', 'Count the workers on site'], 1],
  ['Poor drying of green bricks before firing usually leads to:',
    ['Stronger bricks', 'More cracks and breakage', 'Faster firing', 'Lower fuel use'], 1],
].map(([question, options, correctOption]) => ({
  question, type: 'mcq', options, correctOption, points: 1, difficulty: 'easy',
}));

modules.push({
  title: 'Final Assessment · Field Visit Capacity Quiz',
  type: 'quiz', order: 9, duration: 20,
  isFinalAssessment: true,
  description: 'Eighteen questions. Choose the single best answer. Pass mark 70 percent. Unlimited attempts. Passing issues your certificate.',
  quizQuestions: QUIZ,
});

const doc = {
  title: TITLE,
  description: 'A four-day Training of Trainers on zigzag brick kiln operation: climate and green finance, occupational safety and health, competency-based training and green skills, the brick kiln sector and zigzag conversion, and a field visit to an operating kiln. Complete the sessions and pass the field-visit quiz to earn a verified certificate.',
  trade: 'zigzag-brick-kiln-operation',
  nqfLevel: 3,
  instructor: 'ILO Just Transition Project / PPMC KP',
  institution: 'SBBWU Peshawar · PPMC KP',
  duration: 'Four days (21 to 24 July 2026)',
  startDate: new Date('2026-07-21T00:00:00Z'),
  endDate: new Date('2026-07-24T00:00:00Z'),
  status: 'active',
  openEnrollment: true,
  maxEnrollment: 60,
  passMark: 70,
  retakesAllowed: true,
  difficulty: 'intermediate',
  tags: ['Green Skills', 'Zigzag', 'Brick Kiln', 'Training of Trainers', 'ILO'],
  issuers: ['ILO', 'SBBWU', 'KP-TEVTA', 'GIZ', 'WHH', 'EPA', 'BKOA', 'WWB'],
  signatory: { name: 'Prof. Dr. Yasir Kamal', title: 'Chief Master Trainer' },
  signatories: [
    { name: 'Prof. Dr. Yasir Kamal', title: 'Chief Master Trainer', org: '', signatureUrl: '/api/uploads/material-1784048597000-yasirsig2026.png' },
  ],
  logos: ['ppmc_cert.png', 'sbbwu_cert.png'],
  gradingConfig: { weights: { quiz: 100, practical: 0, scenario: 0, participation: 0 } },
  trainers: [
    { key: 't1', name: 'Prof. Dr. Yasir Kamal', topic: 'Climate Change and Green Skills', order: 1 },
    { key: 't2', name: 'Haider Khan', topic: 'Occupational Safety and Health (OSH)', order: 2 },
    { key: 't3', name: 'Malik Riaz', topic: 'Practical OSH', order: 3 },
    { key: 't4', name: 'Mr. Hamid Fawad', topic: 'Quality Controls in Brick Kiln', order: 4 },
    { key: 't5', name: 'Maqsood Bacha', topic: 'DACUM & Curricula Development', order: 5 },
    { key: 't6', name: 'Mr. Tahir Khan', topic: 'CBT & TVET Reforms', order: 6 },
    { key: 't7', name: 'Mr. Hamid Fawad', topic: 'Practical on Brick Kiln', order: 7 },
  ],
  modules,
};

async function run() {
  await mongoose.connect(env.MONGODB_URI);
  let t = await Training.findOne({ title: TITLE });
  if (t) {
    // Preserve enrollments; refresh everything else.
    const keepEnrollments = t.enrollments;
    // Keep existing module _ids (matched by title) so learners' saved progress
    // and quiz attempts stay valid across reseeds — otherwise a reseed hands
    // every module a new _id and any open session submits to a stale id.
    const idByTitle = new Map((t.modules || []).map(m => [m.title, m._id]));
    doc.modules = doc.modules.map(m => (idByTitle.has(m.title) ? { ...m, _id: idByTitle.get(m.title) } : m));
    Object.assign(t, doc);
    t.enrollments = keepEnrollments;
    await t.save();
    console.log('UPDATED existing ToT training:', t._id.toString());
  } else {
    t = await Training.create(doc);
    console.log('CREATED ToT training:', t._id.toString());
  }
  console.log('JOIN URL:  https://tl.ppmc.pk/join/' + t._id.toString());
  console.log('openEnrollment:', t.openEnrollment, '| maxEnrollment:', t.maxEnrollment, '| modules:', t.modules.length, '| passMark:', t.passMark);
  await mongoose.disconnect();
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
