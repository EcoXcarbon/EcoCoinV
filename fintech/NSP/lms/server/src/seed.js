import 'dotenv/config';
import { readFileSync } from 'fs';
import connectDB from './config/db.js';
import User from './models/User.js';
import Worker from './models/Worker.js';
import Credential from './models/Credential.js';
import Assessment from './models/Assessment.js';
import Training from './models/Training.js';
import Pathway from './models/Pathway.js';
import { BadgeDefinition, LearnerProfile } from './models/Achievement.js';

/* ─── Load NAVTTC curricula (50 curricula: 25 trades × Level 2 + Level 3) ─── */
const navttcData = JSON.parse(readFileSync(new URL('./data/navttc-curricula.json', import.meta.url), 'utf-8'));

/* ─── Load Gulf / City & Guilds curricula (50 curricula: 25 trades × Level 2 + Level 3) ─── */
const gulfData = JSON.parse(readFileSync(new URL('./data/gulf-curricula.json', import.meta.url), 'utf-8'));


/* ─── YouTube video URLs for video modules (2 per trade) — verified working 2026-02-27 ─── */
const VIDEO_URLS = {
  mason: [
    'https://www.youtube.com/watch?v=VC06DfVrUJo',   // Mike Haduck — Brick Laying techniques
    'https://www.youtube.com/watch?v=V8NIwWloJOg',   // Masonry Foundation — Downes Construction
  ],
  electrician: [
    'https://www.youtube.com/watch?v=kYwNj9uauJ4',   // What is Electric Current? — SparkFun
    'https://www.youtube.com/watch?v=mc979OhitAg',   // How Electricity Works — Engineering Mindset
  ],
  welder: [
    'https://www.youtube.com/watch?v=QXJVE5dqHsg',   // Arc Welding Basics — SMAW Fundamentals
    'https://www.youtube.com/watch?v=gc9fBVq9NlE',   // MIG Welding Basics — TimWelds
  ],
  plumber: [
    'https://www.youtube.com/watch?v=Ul1Bh4tlXmA',   // Beginner's Guide to Plumbing — Roger Wakefield
    'https://www.youtube.com/watch?v=OJkj4T9_X9I',   // Four Types of Pipes Explained — 1 Tom Plumber
  ],
  carpenter: [
    'https://www.youtube.com/watch?v=y7gLvEYoBu0',   // What Kind of Wood Should You Build With? — Steve Ramsey
    'https://www.youtube.com/watch?v=dVbBZwylmf8',   // Essential Carpentry Tools — All Pro Assemble
  ],
  hvac: [
    'https://www.youtube.com/watch?v=dQVTT9fWiHU',   // Refrigeration Cycle Animation
    'https://www.youtube.com/watch?v=2mKwCmaR5Qg',   // Mini Split AC Installation
  ],
  'steel-fixer': [
    'https://www.youtube.com/watch?v=Tq1kIZmVSuc',   // Tying Reinforcing Steel Bars — Rebar
    'https://www.youtube.com/watch?v=ZD02jIgvcsc',   // Steel Reinforcement for Concrete Footings
  ],
  painter: [
    'https://www.youtube.com/watch?v=bLbUIevOxzY',   // How To Paint A Room — Home RenoVision DIY
    'https://www.youtube.com/watch?v=1dFXDuLL4EI',   // Painting Walls Professional — Paint Life TV
  ],
  'pipe-fitter': [
    'https://www.youtube.com/watch?v=KIZurpeGMoM',   // Pipe-Fitting Basics
    'https://www.youtube.com/watch?v=KIZurpeGMoM',   // Pipe-Fitting Basics (reuse)
  ],
  scaffolder: [
    'https://www.youtube.com/watch?v=VC06DfVrUJo',   // Construction Training (fallback)
    'https://www.youtube.com/watch?v=V8NIwWloJOg',   // Masonry/Construction (fallback)
  ],
  rigger: [
    'https://www.youtube.com/watch?v=QXJVE5dqHsg',   // Welding/Rigging (fallback)
    'https://www.youtube.com/watch?v=gc9fBVq9NlE',   // MIG/Metal Work (fallback)
  ],
  'crane-operator': [
    'https://www.youtube.com/watch?v=dQVTT9fWiHU',   // Heavy Equipment (fallback)
    'https://www.youtube.com/watch?v=2mKwCmaR5Qg',   // Equipment Operation (fallback)
  ],
  'heavy-driver': [
    'https://www.youtube.com/watch?v=lrCwmpjR77U',   // How Cars Work — Explained
    'https://www.youtube.com/watch?v=lrCwmpjR77U',   // How Cars Work (reuse)
  ],
  'shuttering-carpenter': [
    'https://www.youtube.com/watch?v=y7gLvEYoBu0',   // Wood/Carpentry — Steve Ramsey
    'https://www.youtube.com/watch?v=dVbBZwylmf8',   // Carpentry Tools
  ],
  'tile-fixer': [
    'https://www.youtube.com/watch?v=Way5bMh-eYg',   // Wall Tiling for Beginners
    'https://www.youtube.com/watch?v=Way5bMh-eYg',   // Wall Tiling (reuse)
  ],
  'duct-fabricator': [
    'https://www.youtube.com/watch?v=dQVTT9fWiHU',   // HVAC/Refrigeration Cycle
    'https://www.youtube.com/watch?v=2mKwCmaR5Qg',   // Mini Split AC
  ],
  'auto-mechanic': [
    'https://www.youtube.com/watch?v=lrCwmpjR77U',   // How Cars Work — Explained
    'https://www.youtube.com/watch?v=lrCwmpjR77U',   // How Cars Work (reuse)
  ],
  'diesel-mechanic': [
    'https://www.youtube.com/watch?v=lrCwmpjR77U',   // How Cars Work — Explained
    'https://www.youtube.com/watch?v=lrCwmpjR77U',   // How Cars Work (reuse)
  ],
  fabricator: [
    'https://www.youtube.com/watch?v=QXJVE5dqHsg',   // Arc Welding/Metal Work
    'https://www.youtube.com/watch?v=gc9fBVq9NlE',   // MIG Welding/Fabrication
  ],
  'insulation-worker': [
    'https://www.youtube.com/watch?v=dQVTT9fWiHU',   // HVAC/Insulation Related
    'https://www.youtube.com/watch?v=2mKwCmaR5Qg',   // AC/Insulation Related
  ],
  'heavy-equipment-operator': [
    'https://www.youtube.com/watch?v=Q_fFattg8N0',   // Heavy Equipment Operation
    'https://www.youtube.com/watch?v=Q_fFattg8N0',   // Heavy Equipment (reuse)
  ],
  'aluminium-fabricator': [
    'https://www.youtube.com/watch?v=QXJVE5dqHsg',   // Welding/Metal Fabrication
    'https://www.youtube.com/watch?v=gc9fBVq9NlE',   // MIG/Fabrication
  ],
  'safety-officer': [
    'https://www.youtube.com/watch?v=VC06DfVrUJo',   // Construction Safety (fallback)
    'https://www.youtube.com/watch?v=V8NIwWloJOg',   // Construction (fallback)
  ],
  cook: [
    'https://www.youtube.com/watch?v=ZJy1ajvMU1k',   // Gordon Ramsay's Cookery Course
    'https://www.youtube.com/watch?v=bJUiWdM__Qw',   // Professional Cooking Techniques
  ],
  'ac-technician': [
    'https://www.youtube.com/watch?v=dQVTT9fWiHU',   // Refrigeration Cycle
    'https://www.youtube.com/watch?v=2mKwCmaR5Qg',   // Mini Split AC Installation
  ],
};

/* ─── YouTube video URLs for Gulf/City & Guilds video modules (2 per trade) — verified working 2026-02-27 ─── */
const GULF_VIDEO_URLS = {
  mason: [
    'https://www.youtube.com/watch?v=V8NIwWloJOg',   // Masonry Foundation — Downes Construction
    'https://www.youtube.com/watch?v=VC06DfVrUJo',   // Mike Haduck — Brick Laying
  ],
  electrician: [
    'https://www.youtube.com/watch?v=-mHLvtGjum4',   // How ELECTRICITY works
    'https://www.youtube.com/watch?v=r-SCyD7f_zI',   // Basics of Electrical Engineering
  ],
  welder: [
    'https://www.youtube.com/watch?v=gc9fBVq9NlE',   // MIG Welding Basics — TimWelds
    'https://www.youtube.com/watch?v=QXJVE5dqHsg',   // Arc Welding Basics
  ],
  plumber: [
    'https://www.youtube.com/watch?v=OJkj4T9_X9I',   // Four Types of Pipes Explained
    'https://www.youtube.com/watch?v=Ul1Bh4tlXmA',   // Beginner's Guide to Plumbing
  ],
  carpenter: [
    'https://www.youtube.com/watch?v=dVbBZwylmf8',   // Essential Carpentry Tools
    'https://www.youtube.com/watch?v=y7gLvEYoBu0',   // What Kind of Wood — Steve Ramsey
  ],
  hvac: [
    'https://www.youtube.com/watch?v=2mKwCmaR5Qg',   // Mini Split AC Installation
    'https://www.youtube.com/watch?v=dQVTT9fWiHU',   // Refrigeration Cycle
  ],
  'steel-fixer': [
    'https://www.youtube.com/watch?v=ZD02jIgvcsc',   // Steel Reinforcement — Concrete Footings
    'https://www.youtube.com/watch?v=Tq1kIZmVSuc',   // Tying Rebar
  ],
  painter: [
    'https://www.youtube.com/watch?v=ZKxhI4I5kq8',   // Gulf Painter Training
    'https://www.youtube.com/watch?v=bLbUIevOxzY',   // How To Paint A Room
  ],
  'pipe-fitter': [
    'https://www.youtube.com/watch?v=KIZurpeGMoM',   // Pipe-Fitting Basics
    'https://www.youtube.com/watch?v=KIZurpeGMoM',   // Pipe-Fitting (reuse)
  ],
  scaffolder: [
    'https://www.youtube.com/watch?v=V8NIwWloJOg',   // Construction (fallback)
    'https://www.youtube.com/watch?v=VC06DfVrUJo',   // Construction (fallback)
  ],
  rigger: [
    'https://www.youtube.com/watch?v=gc9fBVq9NlE',   // MIG/Metal Work (fallback)
    'https://www.youtube.com/watch?v=QXJVE5dqHsg',   // Welding (fallback)
  ],
  'crane-operator': [
    'https://www.youtube.com/watch?v=2mKwCmaR5Qg',   // Equipment (fallback)
    'https://www.youtube.com/watch?v=dQVTT9fWiHU',   // HVAC/Equipment (fallback)
  ],
  'heavy-driver': [
    'https://www.youtube.com/watch?v=lrCwmpjR77U',   // How Cars Work
    'https://www.youtube.com/watch?v=lrCwmpjR77U',   // How Cars Work (reuse)
  ],
  'shuttering-carpenter': [
    'https://www.youtube.com/watch?v=dVbBZwylmf8',   // Carpentry Tools
    'https://www.youtube.com/watch?v=y7gLvEYoBu0',   // Wood/Carpentry
  ],
  'tile-fixer': [
    'https://www.youtube.com/watch?v=Way5bMh-eYg',   // Wall Tiling for Beginners
    'https://www.youtube.com/watch?v=Way5bMh-eYg',   // Wall Tiling (reuse)
  ],
  'duct-fabricator': [
    'https://www.youtube.com/watch?v=2mKwCmaR5Qg',   // Mini Split AC
    'https://www.youtube.com/watch?v=dQVTT9fWiHU',   // Refrigeration Cycle
  ],
  'auto-mechanic': [
    'https://www.youtube.com/watch?v=lrCwmpjR77U',   // How Cars Work
    'https://www.youtube.com/watch?v=lrCwmpjR77U',   // How Cars Work (reuse)
  ],
  'diesel-mechanic': [
    'https://www.youtube.com/watch?v=lrCwmpjR77U',   // How Cars Work
    'https://www.youtube.com/watch?v=lrCwmpjR77U',   // How Cars Work (reuse)
  ],
  fabricator: [
    'https://www.youtube.com/watch?v=gc9fBVq9NlE',   // MIG Welding/Fabrication
    'https://www.youtube.com/watch?v=QXJVE5dqHsg',   // Arc Welding
  ],
  'insulation-worker': [
    'https://www.youtube.com/watch?v=2mKwCmaR5Qg',   // AC/Insulation Related
    'https://www.youtube.com/watch?v=dQVTT9fWiHU',   // HVAC/Insulation Related
  ],
  'heavy-equipment-operator': [
    'https://www.youtube.com/watch?v=Q_fFattg8N0',   // Heavy Equipment Operation
    'https://www.youtube.com/watch?v=Q_fFattg8N0',   // Heavy Equipment (reuse)
  ],
  'aluminium-fabricator': [
    'https://www.youtube.com/watch?v=gc9fBVq9NlE',   // MIG/Metal Fabrication
    'https://www.youtube.com/watch?v=QXJVE5dqHsg',   // Welding/Fabrication
  ],
  'safety-officer': [
    'https://www.youtube.com/watch?v=V8NIwWloJOg',   // Construction Safety (fallback)
    'https://www.youtube.com/watch?v=VC06DfVrUJo',   // Construction (fallback)
  ],
  cook: [
    'https://www.youtube.com/watch?v=nfY0lrdXar8',   // Gulf Cooking
    'https://www.youtube.com/watch?v=ZJy1ajvMU1k',   // Gordon Ramsay's Cookery Course
  ],
  'ac-technician': [
    'https://www.youtube.com/watch?v=2mKwCmaR5Qg',   // Mini Split AC
    'https://www.youtube.com/watch?v=dQVTT9fWiHU',   // Refrigeration Cycle
  ],
};

/* ─── Rich reading content for reading modules (idx 1 = second topic) ─── */
const READING_CONTENT = {
  mason: `# Brick Patterns & Bonds

## Introduction
Brick bonding is the arrangement of bricks in a structure to create a stable, durable, and aesthetically pleasing wall. In Pakistan's construction industry, understanding brick patterns is essential for every mason, whether building residential homes in Peshawar or commercial structures in Karachi. The bond pattern directly affects the wall's structural integrity, load distribution, and resistance to weather conditions common in Khyber Pakhtunkhwa's varied climate — from hot summers to cold winters.

## Common Bond Patterns

### 1. Stretcher Bond (Running Bond)
The simplest and most widely used bond in Pakistan, especially for single-wythe walls and partitions. Bricks are laid lengthwise with each course offset by half a brick. This bond is common in boundary walls and non-load-bearing partitions throughout KPK.
- **Strength**: Moderate — suitable for half-brick (4.5") walls
- **Usage**: Internal partitions, garden walls, single-skin facades
- **Tip**: Always check the plumb line every 3-4 courses to prevent leaning

### 2. English Bond
Alternating courses of stretchers and headers, considered one of the strongest bonds. This is the preferred bond for load-bearing walls in Pakistani construction, particularly for 9" and 13.5" walls.
- **Strength**: Very high — excellent load distribution
- **Usage**: External load-bearing walls, retaining walls, foundations
- **Step-by-step**: Start with a header course, followed by a stretcher course. Place a queen closer (3/4 brick) next to the corner header to maintain the bond pattern.

### 3. Flemish Bond
Each course has alternating headers and stretchers, creating an attractive pattern. While more decorative than English bond, it requires more skill and is used in premium residential and commercial projects.
- **Strength**: High — slightly less than English bond
- **Usage**: Facade walls, decorative exterior walls
- **Note**: In Pakistani practice, achieving a true Flemish bond requires careful selection of uniformly sized bricks from local kilns.

### 4. Header Bond
All bricks are laid as headers (showing the short face). Used for curved walls and 9" thick walls.
- **Usage**: Curved structures, well walls, circular columns

## Safety Warnings
- Always wear safety gloves when handling bricks — local kiln-fired bricks can have sharp edges
- Use eye protection when cutting bricks with a bolster chisel
- Keep the work area clear of debris to prevent trips and falls
- In hot KPK summers (40°C+), keep bricks and mortar damp to prevent rapid drying which weakens joints
- Never climb incomplete walls — use proper scaffolding (sarya-pipe scaffolding is standard in Pakistan)

## Pakistani Context & Standards
- Standard Pakistani brick size: 9" × 4.5" × 3" (local hand-molded bricks)
- Standard mortar mix: 1:6 (cement:sand) for general work, 1:4 for load-bearing walls
- Local materials: Lawrencepur sand (Punjab), Warsak sand (KPK), and OPC cement from local manufacturers
- During monsoon season (July-September), protect fresh brickwork with plastic sheeting
- PEC (Pakistan Engineering Council) guidelines require minimum 28-day curing for load-bearing walls

## Practical Tips from the Field
1. Always soak bricks in water for at least 2 hours before laying — dry bricks absorb moisture from mortar
2. Keep mortar joints uniform at 10mm (3/8") thickness
3. Use a string line for every course to maintain level
4. Check horizontal alignment with a spirit level at least every 3 courses
5. "Racking back" is preferred over "toothing" when stopping work mid-wall

## Key Takeaways
- English bond is the strongest and most common for load-bearing walls in Pakistan
- Stretcher bond is economical for non-load-bearing partitions
- Always maintain consistent joint thickness for structural integrity
- Proper brick soaking and mortar mixing are critical in Pakistan's hot climate
- Bond pattern selection depends on wall thickness, load requirements, and aesthetics`,

  electrician: `# Wiring Standards & Electrical Codes

## Introduction
Electrical wiring standards are the foundation of safe and reliable electrical installations. In Pakistan, electricians must follow both local Pakistan Engineering Council (PEC) guidelines and international IEC standards. Proper wiring protects lives, prevents fires, and ensures systems function reliably in Khyber Pakhtunkhwa's climate, where temperatures range from -5°C in winter to 48°C in summer, and monsoon humidity can exceed 90%.

## Pakistan Wiring Color Codes
Understanding the correct wire color identification is critical for safety:
- **Phase/Live (L)**: Red (single phase) or Red/Yellow/Blue (three phase)
- **Neutral (N)**: Black
- **Earth/Ground (E)**: Green or Green/Yellow striped
- **Warning**: Never use earth wire as neutral — this is a common and dangerous shortcut observed on some Pakistani construction sites

## Standard Wire Sizes & Applications
| Wire Size (mm²) | Current Rating | Common Usage |
|-----------------|---------------|--------------|
| 1.5 mm² | 10A | Lighting circuits |
| 2.5 mm² | 16A | Socket outlets (standard 13A plugs) |
| 4.0 mm² | 25A | Water heaters, small AC units |
| 6.0 mm² | 32A | Large split AC (1.5-2 ton) |
| 10 mm² | 45A | Cooking ranges, submain circuits |
| 16 mm² | 60A | Main distribution boards |

## Circuit Protection Devices

### MCB (Miniature Circuit Breaker)
Standard protection against overcurrent and short circuits. In Pakistani homes and commercial buildings:
- Type B: General lighting and socket circuits
- Type C: Motor loads, AC compressors (common in KPK's hot climate)
- Type D: Heavy industrial motors, welding equipment

### RCCB/ELCB (Residual Current Circuit Breaker)
Protects against earth leakage and electric shock. **Mandatory** for:
- All socket outlets in wet areas (bathrooms, kitchens)
- Outdoor electrical installations
- Construction site temporary wiring
- Standard sensitivity: 30mA for personal protection, 100mA for fire protection

### Surge Protection
Essential in KPK where power fluctuations and lightning strikes during monsoon are common. Install SPDs (Surge Protection Devices) at the main distribution board.

## Step-by-Step: Wiring a Standard Room Circuit

1. **Plan the layout**: Mark switch and socket positions (switches at 1.2m height, sockets at 300mm from floor level)
2. **Run conduit**: Use 20mm PVC conduit for lighting, 25mm for power circuits. In Pakistani construction, conduit is typically embedded in walls before plastering
3. **Pull wires**: Use 1.5mm² for lighting, 2.5mm² for sockets. Always pull earth wire in every conduit run
4. **Connect switches**: Live wire to switch, switched live to light fitting. Neutral goes directly to the fitting
5. **Connect sockets**: Connect L, N, and E terminals correctly. Pakistan uses BS 546 (5A round pin) and BS 1363 (13A square pin) standards
6. **Test**: Use a multimeter to check continuity, insulation resistance (minimum 1MΩ), and earth loop impedance

## Safety Warnings
- **ALWAYS** isolate the circuit before working — turn off the MCB and lock out the main switch
- Never work on live circuits — use a non-contact voltage tester (NCV) to verify isolation
- In Pakistan's humid monsoon climate, ensure all outdoor connections use IP65-rated enclosures
- WAPDA power supply can fluctuate between 180V-260V — install voltage stabilizers for sensitive equipment
- Use copper conductors only — aluminum wiring is prohibited for internal wiring in modern standards

## Pakistani Context
- Standard supply: 230V single phase, 400V three phase, 50Hz
- WAPDA/PESCO is the primary electricity provider in KPK
- Net metering is available for solar installations — follow NEPRA guidelines
- Energy-efficient wiring with LED lighting reduces electricity bills (critical given current tariff rates)
- All installations should be inspected by a licensed electrical inspector per PEC requirements

## Key Takeaways
- Follow Pakistan's color coding strictly: Red (live), Black (neutral), Green/Yellow (earth)
- Size wires based on load — undersized wiring is a leading cause of electrical fires in Pakistan
- RCCB protection is mandatory for wet areas and outdoor circuits
- Always test circuits before energizing — a methodical approach prevents accidents
- Stay updated on PEC guidelines and NEPRA regulations for compliance`,

  welder: `# GMAW/MIG Welding Process

## Introduction
Gas Metal Arc Welding (GMAW), commonly known as MIG (Metal Inert Gas) welding, is one of the most versatile and productive welding processes used in Pakistan's construction and manufacturing sectors. From structural steel fabrication in Peshawar to pipeline work across KPK, MIG welding offers faster deposition rates and easier learning curve compared to SMAW (stick welding), making it increasingly popular in Pakistani workshops and fabrication facilities.

## How MIG Welding Works
MIG welding uses a continuously fed consumable wire electrode and a shielding gas to protect the weld pool from atmospheric contamination. The process:
1. Wire electrode feeds through the welding gun at a controlled speed
2. An electric arc forms between the wire and workpiece
3. Shielding gas (typically Argon/CO₂ mix) flows through the nozzle to protect the molten weld pool
4. The wire melts and deposits filler metal into the joint

## Equipment & Setup

### Essential Equipment
- **MIG Welding Machine**: 200-250A capacity for general construction work. Popular brands in Pakistan include Jasic, Riland, and imported Lincoln/Miller units
- **Wire Feeder**: Built into most modern machines; ensure rollers match wire diameter
- **Welding Gun/Torch**: Air-cooled for <300A, water-cooled for heavy-duty work
- **Gas Cylinder & Regulator**: Argon/CO₂ mix (75/25 or 80/20) for steel; pure Argon for aluminum
- **Wire Spool**: ER70S-6 is the standard wire for mild steel (0.8mm or 1.0mm diameter)

### Machine Settings (for mild steel)
| Material Thickness | Wire Size | Voltage | Wire Speed | Gas Flow |
|-------------------|-----------|---------|------------|----------|
| 1-3mm | 0.8mm | 17-19V | 4-6 m/min | 12-15 L/min |
| 3-6mm | 1.0mm | 19-22V | 6-8 m/min | 15-18 L/min |
| 6-12mm | 1.0mm | 22-26V | 8-12 m/min | 15-18 L/min |
| 12mm+ | 1.2mm | 24-30V | 8-14 m/min | 18-22 L/min |

## Welding Techniques

### Transfer Modes
1. **Short Circuit Transfer**: Low voltage/wire speed. Used for thin materials (1-3mm) and out-of-position welding. Most common mode in Pakistani fabrication shops
2. **Globular Transfer**: Medium settings. Produces more spatter — generally avoided for quality work
3. **Spray Transfer**: High voltage/wire speed. Used for thick materials in flat/horizontal positions. Gives excellent penetration and clean welds

### Gun Technique
- **Push technique (forehand)**: Gun angled 10-15° in the direction of travel. Produces wider, flatter beads with less penetration. Used for thin materials
- **Pull technique (backhand)**: Gun angled 10-15° away from travel direction. Produces narrower, higher beads with deeper penetration. Preferred for structural work
- **Stickout (CTWD)**: Maintain 10-15mm contact tip to work distance. Too long = poor shielding; too short = spatter buildup on nozzle

## Step-by-Step: Making a Fillet Weld

1. **Prepare the joint**: Clean both pieces with wire brush or grinder. Remove all rust, oil, paint, and mill scale
2. **Tack weld**: Place tack welds at both ends and every 150mm to hold pieces in position
3. **Set parameters**: Refer to the settings table above based on material thickness
4. **Position**: Hold gun at 45° to both pieces (bisecting the joint angle)
5. **Start the arc**: Trigger the gun and allow the arc to establish before moving
6. **Weld**: Travel at steady speed, maintaining consistent stickout and angle. Listen for a steady "frying" sound — this indicates correct settings
7. **End the weld**: Do not break the arc abruptly. Slow down at the end to fill the crater, then release the trigger
8. **Inspect**: Check for consistent bead width, no undercut, no porosity, and proper fusion at toes

## Safety Warnings
- **Ventilation is critical**: MIG welding produces harmful fumes (especially with galvanized steel). In enclosed Pakistani workshops, use exhaust fans or work outdoors when possible
- **Eye protection**: Use auto-darkening helmet with minimum shade #10 for MIG welding
- **Fire prevention**: MIG produces significant spatter — clear all flammable materials within 10m radius
- **Gas cylinder safety**: Always chain cylinders upright. In KPK's hot summer temperatures, keep cylinders shaded (gas pressure increases dangerously in heat)
- **Electric shock**: Ensure proper grounding, especially during monsoon season when humidity increases conductivity

## Pakistani Context
- Most Pakistani fabrication shops are transitioning from pure SMAW to combination SMAW/MIG operations
- Shielding gas supply: Industrial gas suppliers in Peshawar, Islamabad, and Lahore stock Argon and CO₂. In remote KPK areas, flux-cored wire (FCAW) is used when gas supply is unreliable
- Common applications in KPK: Steel structure fabrication, gate manufacturing, grille work, industrial equipment repair
- AWS D1.1 (Structural Welding Code) is the reference standard for construction welding in Pakistan

## Key Takeaways
- MIG welding is faster and easier to learn than SMAW, with higher deposition rates
- Correct machine settings (voltage + wire speed) are critical — use the reference table
- Always clean the base metal thoroughly before welding
- Maintain consistent gun angle, stickout, and travel speed for quality welds
- Proper ventilation and PPE are non-negotiable safety requirements`,

  plumber: `# Joint Types & Pipe Fittings

## Introduction
In Pakistan's plumbing industry, understanding joint types is fundamental to creating leak-free, durable piping systems. Whether installing water supply lines in a Peshawar residence, drainage systems in commercial buildings, or gas piping for heating systems in KPK's cold northern areas, selecting the correct joint type for each application ensures safety, longevity, and code compliance. This module covers all major joint types used in Pakistani plumbing practice.

## Categories of Pipe Joints

### 1. Solvent Cement Joints (PVC/CPVC)
The most common joint type in Pakistani residential plumbing. Used for cold water (PVC) and hot water (CPVC) supply lines.

**Step-by-Step Procedure:**
1. Cut the pipe square using a pipe cutter or fine-tooth hacksaw
2. Deburr the cut end with a file or deburring tool — burrs cause turbulence and trap debris
3. Dry-fit the pipe into the fitting to check depth. Mark insertion depth with a pencil
4. Apply primer (for CPVC) or cleaner (for PVC) to both the pipe end and fitting socket
5. Apply solvent cement liberally to the pipe end, then lightly inside the fitting socket
6. Push the pipe into the fitting with a quarter-turn twist, hold for 30 seconds
7. Wipe excess cement and allow curing time: 2 hours for cold water, 24 hours for pressure testing

**Pakistani brands**: Popular PVC pipe brands include Dadex, Master, Dynasty, and Kisan pipes — all manufactured to PS (Pakistan Standards) specifications.

### 2. Threaded Joints (GI Pipes)
Galvanized Iron (GI) pipes with threaded connections remain common in Pakistani plumbing for water supply mains, especially in older buildings and rural KPK areas.

**Procedure:**
1. Thread the pipe end using a pipe die (1/2", 3/4", 1" are standard sizes)
2. Apply Teflon tape (PTFE) — wrap 5-6 turns clockwise (when looking at the pipe end)
3. Apply pipe dope (thread sealant paste) over the Teflon tape for additional sealing
4. Hand-tighten the fitting, then use pipe wrenches (two wrenches — one to hold, one to turn) for 2-3 additional turns
5. Do not over-tighten — GI fittings can crack, especially at elbows and tees

**Note**: In Peshawar and surrounding areas, GI pipes are being replaced by PPR (Polypropylene Random) pipes for internal water supply due to corrosion issues with local water chemistry.

### 3. PPR Fusion Joints (Hot Water Systems)
PPR (Polypropylene Random Copolymer) pipes use heat fusion to create molecular-bonded joints that are virtually leak-proof. Increasingly popular in modern Pakistani construction.

**Procedure:**
1. Cut the PPR pipe square with PPR pipe scissors
2. Clean the pipe end and fitting socket
3. Heat the fusion tool to 260°C (most tools have a green indicator light)
4. Simultaneously insert the pipe into the female die and the fitting onto the male die
5. Heat for the specified time: 5 seconds for 20mm, 7 seconds for 25mm, 12 seconds for 32mm
6. Remove both pieces from the tool and immediately push together straight (NO twisting)
7. Hold for 10-15 seconds until the joint cools and sets

### 4. Compression Joints
Used for connecting different pipe materials, water meter installations, and locations requiring future disassembly.
- Brass compression fittings are standard for water supply connections in Pakistan
- Always use the correct olive (ferrule) size — do not reuse old olives

### 5. Flange Joints
Used for large-diameter pipes (4" and above) in commercial and industrial plumbing, pump connections, and water treatment facilities.

## Drainage Joint Types

### Push-Fit (Ring Seal) Joints
Standard for uPVC drainage pipes in Pakistan:
1. Apply silicone lubricant to the rubber seal inside the fitting socket
2. Push the pipe in until it reaches the insertion mark
3. Pull back 10mm to allow thermal expansion space

### Solvent Weld Drainage Joints
Used where push-fit joints are not suitable (above-ground waste pipes):
- Same procedure as supply pipe solvent joints
- **Critical**: Drainage pipes must maintain correct slope — 1/4" per foot (20mm per meter) minimum

## Safety Warnings
- Always shut off the main water supply before working on any pipe system
- When working with GI pipes, be cautious of lead-based solder in older Pakistani buildings — use lead-free alternatives
- PPR fusion: The tool reaches 260°C — keep away from flammable materials and wear heat-resistant gloves
- Gas pipe joints (natural gas/LPG): ONLY use approved threaded joints with specific gas-rated sealants. Solvent cement joints are NEVER acceptable for gas lines
- Test all joints under pressure before concealing in walls — standard test pressure in Pakistan is 1.5x working pressure for minimum 2 hours

## Pakistani Context
- Water pressure varies widely in KPK — from gravity-fed tanks (low pressure) to booster pump systems (high pressure). Joint selection must account for working pressure
- In Peshawar's hot summers (45°C+), PVC pipes exposed to direct sunlight can soften. Use UV-resistant pipes or provide shade/insulation for external runs
- Local plumbing shops (Namak Mandi area in Peshawar, Karkhano Market) stock all fitting types. Verify ISI/PS marking on all materials
- During winter in northern KPK (Swat, Chitral, Dir), insulate all exposed pipes to prevent freezing — use foam pipe insulation or locally available wrapping materials

## Key Takeaways
- Solvent cement joints (PVC/CPVC) are standard for residential supply — always allow proper curing time
- PPR fusion creates the strongest, most reliable joints for hot and cold water
- Threaded joints require proper Teflon tape and thread sealant application
- Always pressure-test joints before concealing them in walls or floors
- Match joint type to pipe material, application, and local water conditions`,

  carpenter: `# Hand Tools Mastery

## Introduction
Hand tools are the foundation of carpentry craftsmanship. In Pakistan's construction and furniture industry, a skilled carpenter (mistri) is defined by their command of hand tools — from the basic measuring tape to the precision of a hand plane. In Khyber Pakhtunkhwa, where both traditional woodwork (door/window frames, roof trusses) and modern furniture making are major occupations, mastering hand tools is the first step toward professional competence and higher NQF certification levels.

## Essential Measuring & Marking Tools

### Steel Measuring Tape (Fita)
The most frequently used tool on any carpentry job:
- **Standard sizes**: 3m for small work, 5m for furniture, 8m for site carpentry
- **Technique**: Hook the end tab firmly, pull straight without sagging. For internal measurements, add the tape body width (usually 75mm)
- **Local tip**: In KPK's dusty construction sites, clean the tape regularly — grit causes inaccurate retraction and readings

### Try Square
Essential for checking and marking 90° angles:
- Hold the stock firmly against the wood edge
- Mark along the blade with a sharp pencil or marking knife
- **Test accuracy**: Mark a line, flip the square, and check alignment. If it doesn't match, the square is inaccurate — replace it

### Marking Gauge
Used to scribe parallel lines along wood grain (for mortise and tenon layouts, rebates, etc.):
- Set the distance with a steel rule, then lock the thumbscrew
- Hold the stock against the face side and push away from your body
- Use light pressure to avoid tearing the grain

### Combination Square
Versatile tool for 90° and 45° marking, depth measurement, and as a short straightedge. Essential for furniture work.

## Cutting Tools

### Hand Saw (Aara)
Types used in Pakistani carpentry:
1. **Crosscut saw (18-22 TPI)**: Cuts across the grain — used for cutting wood to length
2. **Rip saw (5-8 TPI)**: Cuts along the grain — used for ripping boards to width
3. **Tenon saw (backsaw)**: Fine-toothed with a rigid back — used for joinery cuts
4. **Coping saw**: Thin blade for curved cuts

**Technique for straight cuts:**
1. Mark the cut line clearly on all visible faces
2. Position the saw on the waste side of the line (the line stays on the good piece)
3. Start with light backward strokes to establish the kerf
4. Use full-length strokes at approximately 45° for crosscutting, 60° for ripping
5. Support the waste piece near the end of the cut to prevent splintering
6. Let the saw do the work — do not force or twist the blade

### Chisels (Randa/Chheni)
Fundamental for joinery, mortising, and fine shaping:
- **Firmer chisel**: General-purpose, flat blade — most common type in Pakistani workshops
- **Mortise chisel**: Thicker, stronger — designed for chopping mortises with a mallet
- **Bevel-edge chisel**: Allows access to tight corners — essential for dovetails

**Sharpening procedure:**
1. Flatten the back on a coarse stone (200 grit), then medium (800 grit), then fine (3000+ grit)
2. Hone the bevel at 25° on the sharpening stone — maintain consistent angle
3. Remove the burr by stroking the flat side on the fine stone
4. Test sharpness: a sharp chisel should slice thin paper cleanly

### Hand Plane (Randa)
Used for smoothing, flattening, and dimensioning wood:
- **Jack plane (No. 5)**: General-purpose — the workhorse of the workshop
- **Smoothing plane (No. 4)**: Final surface preparation — produces a glass-smooth finish
- **Block plane**: One-handed use for end grain, chamfers, and trimming

## Striking & Fastening Tools

### Claw Hammer
Standard 16 oz (450g) for general carpentry, 20 oz (570g) for framing:
- Strike with the center of the face — not the edge
- For nail pulling, place a thin piece of wood under the hammer head to protect the work surface

### Wooden Mallet
Used with chisels — never strike a chisel with a steel hammer (damages the handle):
- Also used for assembling joints (tap pieces together without marring)

### Screwdrivers
Phillips (#2 is most common) and flat-head. Match the screwdriver tip to the screw head exactly to prevent cam-out and damage.

## Safety Warnings
- Keep all cutting tools sharp — a dull tool requires more force and is more likely to slip
- Always cut away from your body
- Wear safety glasses when chiseling — wood chips can fly unpredictably
- Secure workpieces in a vise or with clamps — never hold work with one hand while cutting with the other
- In Pakistani workshops, ensure adequate lighting — many small workshops have poor illumination
- Keep the work area clean — wood shavings create slip hazards and fire risks
- When working with Shisham (Dalbergia sissoo) or Deodar (Cedrus deodara) — common Pakistani timbers — be aware of dust allergies

## Pakistani Context
- Common Pakistani timbers: Shisham (rosewood), Deodar (cedar), Partal (pine), Kikar (acacia), and imported Meranti
- Local hand tool markets: Namak Mandi (Peshawar), Shah Alam Market (Lahore), Shershah (Karachi)
- Traditional Pakistani carpentry uses many hand tools that are locally forged — quality varies, so always test before buying
- NQF Level 2 certification requires demonstrated proficiency with measuring, marking, cutting, and assembly hand tools
- Modern workshops increasingly use power tools, but hand tool skills remain essential for fine joinery, site work, and situations without electricity (common in rural KPK construction)

## Key Takeaways
- Accurate measuring and marking is the foundation of quality carpentry — "measure twice, cut once"
- Keep all cutting tools properly sharpened — this is a safety issue as much as a quality issue
- Use the correct tool for each task — forcing a tool into the wrong application damages both tool and work
- Practice basic joints (butt, lap, mortise and tenon) until they fit tightly by hand
- Invest in quality measuring tools first — they affect every subsequent operation`,

  hvac: `# Ductwork Design & Fabrication

## Introduction
Ductwork is the distribution system that delivers conditioned air throughout a building. In Pakistan's HVAC industry, proper ductwork design is critical for achieving comfortable indoor temperatures — especially important in KPK where summer temperatures exceed 45°C in Peshawar, Kohat, and DI Khan, and winters can drop below freezing in Swat, Chitral, and Abbottabad. Poorly designed ductwork wastes energy, creates noise, and fails to deliver adequate cooling or heating to occupied spaces.

## Types of Duct Systems

### 1. Rectangular Sheet Metal Ducts
The most common duct type in Pakistani commercial construction:
- Made from galvanized steel sheet (GI sheet) — 24 gauge for small ducts, 22 gauge for medium, 20 gauge for large
- **Advantages**: Easy to fabricate locally, good for space-constrained areas (low ceiling voids), widely available in Pakistani markets
- **Disadvantages**: Higher air leakage at joints, requires careful sealing
- **Local fabrication**: Most HVAC contractors in Peshawar and Islamabad fabricate rectangular ducts in their own workshops using locally sourced GI sheets

### 2. Round/Spiral Ducts
Increasingly used in modern Pakistani construction:
- **Advantages**: Lower friction loss (better airflow), less material per unit of airflow capacity, more rigid
- **Disadvantages**: Require more ceiling void height, harder to fabricate locally
- **Pakistani context**: Round ducts are primarily used in industrial applications and premium commercial buildings. Supply is limited compared to rectangular ducts

### 3. Flexible Ducts
Used for final connections from main ducts to diffusers/grilles:
- Maximum recommended length: 1.8m (6 feet) — longer runs create excessive pressure drop
- Must be fully stretched during installation — never leave compressed
- **Warning**: In Pakistani construction, flex duct is often overused as a shortcut. Keep runs short and support every 1.5m

### 4. Insulated Duct Board
Fiberglass duct board is used for low-velocity applications:
- Self-insulating (no additional insulation needed)
- Not recommended for humid environments without proper vapor barrier — relevant during KPK's monsoon season

## Duct Sizing Methodology

### Equal Friction Method (Most Common in Pakistan)
Design ductwork so that friction loss per meter is constant throughout the system:
1. **Calculate total cooling/heating load** for each room (in BTU/h or kW)
2. **Determine airflow (CFM)** for each outlet: CFM = Total BTU / (1.08 × ΔT). For typical Pakistani conditions (supply at 14°C, room at 24°C), ΔT = 10°C
3. **Select friction rate**: Standard is 0.08-0.1 inches WG per 100 feet (0.8-1.0 Pa/m) for low-velocity commercial systems
4. **Size ducts using friction chart**: Look up the required duct size for the calculated CFM and friction rate
5. **Verify velocity**: Main ducts should not exceed 6 m/s (residential) or 8 m/s (commercial) to prevent noise

### Quick Sizing Reference
| CFM | Round Duct (inches) | Rectangular Equivalent |
|-----|--------------------|-----------------------|
| 100 | 6" | 8" × 5" |
| 200 | 8" | 10" × 6" |
| 400 | 10" | 14" × 8" |
| 600 | 12" | 16" × 10" |
| 1000 | 14" | 20" × 12" |
| 1500 | 16" | 24" × 14" |
| 2000 | 18" | 28" × 16" |

## Fabrication Procedures

### Step-by-Step: Rectangular Duct Fabrication
1. **Calculate dimensions** from the duct sizing chart
2. **Cut GI sheet** to size using tin snips or a sheet metal guillotine. Add 25mm for Pittsburgh lock seam on two sides and 25mm for drive slip on the other two
3. **Form the Pittsburgh lock seam**: Bend one edge into a pocket (double fold), and the mating edge into a single fold that hooks into the pocket
4. **Assemble the duct section**: Hook the seams together and hammer flat
5. **Add drive slips or flanges**: For connecting sections together. TDC (Transverse Duct Connection) flanges are standard for commercial work in Pakistan
6. **Seal all joints**: Apply duct sealant (mastic) to all seams and connections. This step is often skipped in Pakistani construction but is critical for efficiency
7. **Insulate**: Wrap with fiberglass insulation (25mm minimum) and cover with aluminum foil vapor barrier

## Installation Best Practices
- Maintain at least 50mm clearance between ductwork and electrical conduits
- Support rectangular ducts every 2.4m (8 feet) maximum with trapeze hangers
- Install volume dampers at each branch takeoff for air balancing
- Use turning vanes in all 90° rectangular elbows to reduce pressure loss
- Seal all joints with duct sealant — tape alone is not sufficient (despite common Pakistani practice)

## Safety Warnings
- Wear cut-resistant gloves when handling sheet metal — edges are razor-sharp
- Use hearing protection when operating fabrication machinery (shears, brakes, folders)
- Ensure proper ventilation when applying sealants and adhesives
- When working in ceiling voids, verify structural capacity before walking on ceiling grids
- In Pakistan's summer heat, sheet metal stored in sun can cause severe burns — handle with gloves

## Pakistani Context
- Major HVAC supply markets: I-9 Industrial Area (Islamabad), Badami Bagh (Lahore), SITE Area (Karachi)
- In KPK, most ductwork fabrication is done by local tinsmiths (qalai gar) who have adapted their skills to HVAC work
- Energy efficiency is increasingly important given rising electricity costs (PKR 40-65/kWh for commercial users)
- ASHRAE standards are referenced in Pakistani HVAC design, but local adaptations account for extreme heat, dust, and power fluctuations
- Duct cleaning services are emerging in major cities but not yet common in KPK — design for access panels at key points

## Key Takeaways
- Correct duct sizing prevents noise, energy waste, and comfort complaints
- The Equal Friction method is the standard design approach for Pakistani HVAC systems
- Seal all duct joints — air leakage from unsealed ducts wastes 20-30% of cooling capacity
- Insulate all supply ducts to prevent condensation (critical in humid Pakistani climate)
- Support ductwork properly and maintain clearances from other building services`,

  'steel-fixer': `# Bar Bending Schedules

## Introduction
A Bar Bending Schedule (BBS) is the detailed document that lists all reinforcement steel bars required for a structure — including their shapes, dimensions, lengths, and quantities. In Pakistan's construction industry, accurate BBS preparation is essential for material estimation, cost control, and ensuring structural integrity. For steel fixers (sarya mistri) working across KPK's construction sites, reading and executing a BBS correctly is a core competency requirement for NQF Level 3 certification.

## Purpose of Bar Bending Schedule
1. **Material estimation**: Calculate exact tonnage of steel required, reducing waste and controlling costs
2. **Cutting & bending guide**: Provides precise dimensions for each bar shape
3. **Quality control**: Allows engineers to verify that correct reinforcement is placed
4. **Cost accounting**: Enables accurate billing for steel fixing contractors
5. **Site coordination**: Ensures bars are fabricated and ready when needed in the construction sequence

## BBS Terminology

### Key Terms
- **Bar Mark**: Unique identifier for each bar type (e.g., A1, B2, C3)
- **Type/Shape Code**: Standard shape reference (straight, bent, hook, stirrup, etc.)
- **Diameter (φ)**: Bar diameter in millimeters (8mm, 10mm, 12mm, 16mm, 20mm, 25mm are standard in Pakistan)
- **Cutting Length**: Total length of bar before bending
- **Number of Bars**: Quantity required
- **Total Length**: Cutting length × number of bars
- **Unit Weight**: kg per meter for each diameter
- **Total Weight**: Total length × unit weight

### Standard Bar Weights (per meter)
| Diameter (mm) | Weight (kg/m) | Common Usage in Pakistan |
|---------------|--------------|--------------------------|
| 8 | 0.395 | Stirrups, ties, distribution bars |
| 10 | 0.617 | Slab main bars, light beams |
| 12 | 0.888 | Slab main bars, columns |
| 16 | 1.579 | Beams, columns, footings |
| 20 | 2.467 | Heavy beams, columns, retaining walls |
| 25 | 3.854 | Foundation beams, piles, heavy columns |

**Formula**: Weight (kg/m) = (Diameter in mm)² / 162

## Cutting Length Calculations

### Important Deductions & Additions
When calculating cutting length from the structural drawing, account for:

1. **Bends**: For each 90° bend, deduct **2d** (where d = bar diameter) from the total length
   - Example: A bar with 2 bends at 90° using 12mm bar → deduct 2 × 2 × 12 = 48mm
2. **Hooks**: For each standard hook (180°), add **9d**
   - Example: A stirrup with hooks using 8mm bar → add 2 × 9 × 8 = 144mm
3. **135° Hook (seismic hook)**: Add **6d** per hook — required in seismic Zone 2B (KPK falls in this zone)

### Common Shape Calculations

**Shape 1: Straight Bar**
- Cutting Length = Span length - (2 × cover) + (2 × hook allowance if hooked)

**Shape 2: Bent-up Bar (Cranked)**
- Cutting Length = L₁ + (0.42 × crank height) + L₂ - (2 × 2d for bends)

**Shape 3: Standard Stirrup (Rectangular)**
- Cutting Length = 2(A + B) - (8d for 4 bends) + (2 × hook allowance)
- Where A = width of beam minus 2 × cover, B = depth of beam minus 2 × cover

**Shape 4: Circular Ring**
- Cutting Length = π × (Diameter - bar diameter) + (2 × hook allowance)

## Step-by-Step: Preparing a BBS

1. **Study the structural drawing**: Identify all reinforcement details — footing, columns, beams, slabs
2. **List all bar marks**: Assign unique mark numbers (e.g., F1 for footing bar 1, C1 for column bar 1)
3. **Determine shape code**: Identify the shape of each bar from standard shape codes
4. **Calculate cutting lengths**: Apply the formulas above, accounting for bends and hooks
5. **Count quantities**: Multiply by the number of similar members (e.g., if 8 identical columns, each bar count × 8)
6. **Calculate total lengths**: Cutting length × quantity for each bar mark
7. **Calculate weights**: Total length × unit weight for each diameter
8. **Add wastage**: Standard practice in Pakistan is to add 3-5% for cutting waste and lapping
9. **Tabulate**: Present in standard BBS format with columns for Mark, Shape, Dia, Length, No., Total Length, Weight

## Sample BBS Entry

| Mark | Shape | Dia (mm) | Cut Length (m) | No. | Total (m) | Weight (kg) |
|------|-------|----------|---------------|-----|-----------|-------------|
| F1 | Straight | 16 | 2.80 | 12 | 33.60 | 53.05 |
| F2 | Straight | 12 | 1.80 | 8 | 14.40 | 12.79 |
| C1 | Straight | 16 | 3.60 | 24 | 86.40 | 136.43 |
| C2 | Stirrup | 8 | 1.24 | 120 | 148.80 | 58.78 |

## Safety Warnings
- Always wear safety glasses when cutting rebar — fragments can fly
- Use proper guards on bar cutting machines (churi machine)
- Bar bending machines (hand-operated or motorized) can crush fingers — keep hands clear of moving parts
- Tie all protruding rebar ends with plastic caps (mushroom caps) to prevent impalement — this is often neglected on Pakistani sites
- Steel bars left in sun can reach 70°C+ in KPK summers — wear gloves when handling

## Pakistani Context
- Steel grades: Fe-415 (most common) and Fe-500 are standard in Pakistani construction per Pakistan Building Code
- Local steel brands: Amreli, Ittefaq, Mughal, AF Steel — always verify ISI/PSQCA marking
- BBS is typically prepared by the structural engineer or site engineer, but experienced steel fixers must verify dimensions before cutting
- In KPK's seismic Zone 2B, all stirrup hooks must be 135° (seismic hooks) — 90° hooks are NOT acceptable per building code
- Standard concrete cover: 25mm for slabs, 40mm for beams, 50mm for columns, 75mm for footings

## Key Takeaways
- BBS accuracy directly affects material costs — a 5% error on a large project means significant financial loss
- Always account for bend deductions and hook additions in cutting length calculations
- Use the standard weight formula: Weight = D²/162 (kg/m) to calculate steel tonnage
- Add 3-5% wastage allowance for cutting and lapping
- Verify bar diameter and grade before cutting — mistakes in rebar cannot be reversed`,

  painter: `# Paint Types & Selection Guide

## Introduction
Selecting the correct paint type is one of the most important decisions in any painting project. In Pakistan's construction industry, painters must understand the properties, applications, and limitations of different paint types to deliver durable, attractive finishes. KPK's climate presents unique challenges — extreme summer heat in Peshawar and DI Khan, cold winters in Swat and Abbottabad, heavy monsoon rains, and high dust levels — all of which affect paint selection and performance.

## Categories of Paint

### 1. Distemper (Kalai)
The most basic and economical wall coating in Pakistan:
- **Dry Distemper**: Mixed with water on-site. Cheapest option, used for ceilings and budget interior walls. Available from local manufacturers in KPK
- **Oil-bound Distemper (OBD)**: Better quality, slight sheen, more washable than dry distemper
- **Advantages**: Very low cost (PKR 800-1500 per 20kg), easy to apply, good coverage
- **Disadvantages**: Not washable (dry type), low durability, chalks over time, not suitable for exterior use
- **Usage**: Interior ceilings, budget rental properties, temporary structures
- **Coverage**: 100-120 sq ft per kg (dry distemper), 80-100 sq ft per kg (OBD)

### 2. Emulsion Paint (Water-Based)
The standard choice for interior and exterior walls in modern Pakistani construction:

**Interior Emulsion:**
- **Finish**: Available in matt, silk (low sheen), and satin finishes
- **Advantages**: Low odor, quick drying (2-4 hours between coats), easy cleanup with water, good color range
- **Brands popular in Pakistan**: Berger, Nippon, Diamond, Master, ICI Dulux
- **Coverage**: 100-120 sq ft per liter per coat
- **Best for**: Living rooms, bedrooms, offices, hospitals, schools

**Exterior Emulsion:**
- **Properties**: Added UV resistance, water resistance, anti-fungal/anti-algae agents
- **Critical in KPK**: Must withstand monsoon rains, 45°C+ heat, and freeze-thaw cycles in northern areas
- **Application**: Apply during dry weather (October-March in KPK for best results)
- **Coverage**: 80-100 sq ft per liter per coat

### 3. Enamel Paint (Oil-Based)
Used for wood, metal, and surfaces requiring high durability:
- **Synthetic Enamel**: Standard quality, moderate gloss, good durability. Most common in Pakistani market
- **Alkyd Enamel**: Premium quality, high gloss, excellent adhesion and durability
- **Advantages**: Hard, durable finish; excellent for doors, windows, gates, and railings
- **Disadvantages**: Strong odor, slow drying (12-24 hours), requires thinner for cleanup, yellows over time (white enamel)
- **Usage**: All wood and metal surfaces — doors (darwaza), windows (khirki), gates, furniture
- **Thinner**: Use mineral turpentine (safed tail) for thinning and cleanup

### 4. Primer (Base Coat)
Applied before the finish coat to seal surfaces and improve adhesion:
- **Cement Primer**: For new plastered walls — essential to seal alkalinity. Apply after plaster has cured for minimum 28 days
- **Wood Primer (Red/White)**: Red oxide primer for exterior wood and metal; white primer for interior wood
- **Metal Primer (Zinc Chromate)**: Yellow/green primer for steel and iron surfaces — prevents rust
- **PVA Primer**: Water-based primer for interior walls — quick drying

**Critical Rule**: NEVER skip primer. In Pakistan, the most common painting failures (peeling, blistering, flaking) occur because primer was omitted to save cost.

### 5. Specialty Paints
- **Texture Paint**: Creates decorative textured finishes — popular in modern Pakistani homes and commercial spaces
- **Damp-proof Paint**: For basement walls and areas with moisture problems (common in Peshawar's high water table areas)
- **Heat-reflective Paint**: For exterior walls and roofs — reduces indoor temperature by 5-8°C (valuable in KPK's hot areas)
- **Epoxy Paint**: Two-component paint for floors, laboratories, and industrial areas — extremely durable
- **Whitewash (Choona)**: Traditional lime-based coating still used in rural KPK for its low cost and antiseptic properties

## Paint Selection Decision Guide

### For Interior Walls
1. **Budget projects**: Dry distemper (ceilings) + OBD (walls)
2. **Standard residential**: Emulsion paint (matt for ceilings, silk for walls)
3. **Premium/commercial**: Emulsion (satin or gloss) for washable, durable finish
4. **Wet areas (kitchen/bathroom)**: Semi-gloss or gloss emulsion with anti-fungal properties

### For Exterior Walls
1. **Standard**: Exterior emulsion (weather-proof grade)
2. **Premium**: Acrylic exterior paint with added UV and rain protection
3. **Extreme weather areas**: Elastomeric paint (bridges hairline cracks)

### For Wood & Metal
1. **Interior wood**: Wood primer + 2 coats synthetic enamel
2. **Exterior wood**: Red oxide primer + 2 coats alkyd enamel
3. **Metal gates/grilles**: Zinc chromate primer + synthetic or alkyd enamel
4. **For rust prevention**: Apply rust converter before priming if existing rust is present

## Step-by-Step: Complete Wall Painting Process
1. **Surface preparation**: Scrape loose paint, fill cracks with wall putty (2 coats), sand smooth with 180-grit sandpaper
2. **Apply primer**: One coat of appropriate primer. Allow 4-6 hours drying
3. **Putty coat** (optional, for smooth finish): Apply 2 coats of wall putty with putty knife, sanding between coats
4. **First coat**: Dilute paint 10-15% with water (emulsion) or thinner (enamel). Apply evenly with roller or brush
5. **Drying**: Allow 4-6 hours between coats (emulsion) or 12-24 hours (enamel)
6. **Second coat**: Apply undiluted or lightly diluted. Use even strokes in one direction
7. **Inspection**: Check for missed spots, drips, and uneven coverage under good lighting

## Safety Warnings
- Always ensure adequate ventilation when using oil-based paints and thinners
- Wear a dust mask when sanding — paint dust (especially from old buildings) may contain lead
- Keep thinners and oil paints away from heat and open flames — they are highly flammable
- Wear eye protection when scraping overhead surfaces
- Dispose of paint-soaked rags safely — they can spontaneously combust if bunched together (oil-based paints)
- In enclosed spaces, use low-VOC or zero-VOC emulsion paints when available

## Pakistani Context
- Paint costs (2026 estimates): Distemper PKR 800-1500/20kg, Emulsion PKR 4000-8000/gallon, Enamel PKR 3000-6000/gallon
- Local paint markets: Saddar (Peshawar), Anarkali (Lahore), Jodia Bazar (Karachi)
- Apply exterior paint during dry season (October-March) — never during monsoon or when humidity exceeds 85%
- For KPK's northern areas with freeze-thaw cycles, use flexible exterior coatings that expand and contract without cracking
- Rising energy costs have increased demand for heat-reflective roof and wall paints — growing market opportunity for painters

## Key Takeaways
- Always use the correct primer for the surface type — never skip primer
- Emulsion paint is the standard for walls; enamel is for wood and metal
- In Pakistan's climate, exterior paint selection must account for extreme heat, rain, and in some areas, freezing
- Surface preparation is 80% of a good paint job — invest time in scraping, filling, and sanding
- Allow proper drying time between coats — rushing leads to peeling and poor finish`,

  'pipe-fitter': `# Pipe Fitting Fundamentals — Pakistani Construction Context

## Introduction
Pipe fitting is a critical trade in Pakistan's growing industrial and residential sectors. From water supply and gas distribution networks across KPK to industrial piping in refineries and power plants, qualified pipe fitters are in high demand. KPTEVTA and NAVTTC certified pipe fitters work with a range of materials including GI (galvanized iron), PPR, CPVC, and carbon steel pipes per Pakistan Building Code requirements.

## Common Pipe Materials in Pakistan
- **GI Pipe (Galvanized Iron)**: Standard for water supply in residential construction. Available in 0.5" to 6" from local manufacturers (Crescent Steel, Amreli, International Industries)
- **PPR Pipe (Polypropylene Random)**: Increasingly popular for hot and cold water. Heat-fused joints eliminate leak risk. Available from Pakistani brands and Chinese imports
- **CPVC Pipe**: Used for hot water lines (handles up to 93°C). Solvent-cemented joints
- **MS/Carbon Steel Pipe**: Industrial applications — boiler piping, compressed air, fire fighting systems. Requires welding or threading

## Pipe Joining Methods

### 1. Threaded Connections
Standard method for GI pipe in Pakistani plumbing:
1. Cut pipe square using a pipe cutter or hacksaw
2. Ream the inside edge to remove burrs
3. Thread using a manual ratchet die set (1/2" to 2") or powered threading machine for larger sizes
4. Apply Teflon tape (8-10 wraps clockwise) or hemp and jointing compound
5. Hand-tighten, then use pipe wrench for 2-3 additional turns

### 2. PPR Heat Fusion
1. Cut PPR pipe square with pipe shears
2. Mark insertion depth on pipe end
3. Heat pipe and fitting simultaneously on fusion tool (260°C for 5-7 seconds for 25mm pipe)
4. Push together firmly and hold for 10-15 seconds — do not rotate
5. Allow 3 minutes cooling before handling

## Safety Warnings
- Always depressurize lines before cutting or opening any connection
- Wear safety goggles when cutting and threading — metal shavings cause serious eye injuries
- When working with gas lines, ensure proper ventilation and use gas leak detector (soapy water test minimum)
- Hot fusion tools reach 260°C — keep away from flammable materials and use heat-resistant gloves

## Pakistani Context
- Pipe sizes in Pakistan follow BSP (British Standard Pipe) threading, not NPT (American)
- Local GI pipe prices (2026): 0.5" approx PKR 350-450/ft, 1" approx PKR 600-800/ft
- Municipal water supply pressure in most KPK cities is 20-40 psi — design accordingly
- WASA and TMA require licensed plumber/pipe fitter for connection approvals

## Key Takeaways
- Always match pipe material to application — GI for cold water, PPR/CPVC for hot water, steel for industrial
- Threaded joints need proper Teflon tape or hemp wrapping to prevent leaks
- PPR fusion is permanent and leak-proof when done correctly — practice on scrap pieces first
- Test all installations at 1.5x working pressure before commissioning
- Keep pipe runs supported at correct intervals to prevent sagging and stress on joints`,

  'scaffolder': `# Scaffolding Erection & Safety — Pakistani Construction Standards

## Introduction
Scaffolding provides the essential temporary access structure for construction, maintenance, and repair work at height. In Pakistan, scaffolding ranges from traditional bamboo scaffolding (still used in rural KPK) to modern steel tube-and-coupler and frame scaffolding systems on commercial projects. NAVTTC-certified scaffolders ensure structures are erected safely per Pakistan Building Code and international best practices.

## Types of Scaffolding Used in Pakistan

### 1. Steel Tube & Coupler Scaffolding
The most versatile system, standard on large construction sites:
- **Tubes**: 48.3mm OD steel tubes (4mm wall thickness), available in 6m lengths
- **Couplers**: Right-angle (90°), swivel (any angle), and sleeve (join tubes end-to-end)
- **Base plates & adjustable jacks**: Spread load on ground, allow leveling on uneven surfaces
- **Advantage**: Can be configured for any building shape and height

### 2. Frame (H-Frame) Scaffolding
Pre-fabricated frames — faster to erect for straightforward facades:
- Standard frame: 5' wide × 6'4" tall
- Cross-braces lock frames together
- Used extensively for painting, plastering, and facade work in Pakistani cities

### 3. Bamboo Scaffolding
Traditional method still seen in rural KPK and smaller projects:
- Cheaper but far less safe than steel systems
- Not acceptable on regulated commercial or industrial sites
- Being phased out by ESSI (Employees Social Security Institution) enforcement

## Erection Procedure — Tube & Coupler
1. Inspect all components — reject bent tubes, cracked couplers, damaged boards
2. Prepare firm, level ground. Use sole boards (timber planks) under base plates on soft ground
3. Erect standards (vertical tubes) at maximum 2.1m spacing along the building face
4. Fix ledgers (horizontal tubes along the building) at each lift height (maximum 2.0m)
5. Fix transoms (horizontal tubes across the scaffold) at maximum 1.2m spacing
6. Install cross-bracing in zigzag pattern on every other bay for stability
7. Lay scaffold boards (minimum 225mm wide, 38mm thick) on transoms — minimum 3 boards wide for working platform
8. Install guardrails: top rail at 950mm-1100mm, mid rail at 470mm-550mm, and toe board at 150mm minimum
9. Tie scaffold to building at every 4m vertically and 6m horizontally using reveal ties or through-ties

## Safety Warnings
- Falls from scaffolding are the leading cause of construction deaths in Pakistan — always install guardrails before allowing workers on platforms
- Never overload scaffold platforms — maximum 2.0 kN/m² for inspection, 6.0 kN/m² for heavy masonry work
- Do not erect scaffolding during high winds (above 45 km/h) — common in KPK during spring dust storms
- All scaffolders must wear safety harness when working above 2m during erection and dismantling (before guardrails are installed)
- Inspect scaffold daily before use — check all couplers are tight, boards are secure, and ties are intact

## Pakistani Context
- Scaffold tube available from local suppliers in Peshawar, Rawalpindi, Lahore — ensure tubes are tested and stamped
- Many Pakistani sites still lack proper scaffold inspection — NAVTTC trained scaffolders can fill this safety gap
- Labour rates for scaffolders (2026): PKR 1,200-2,000/day depending on region and project type
- Scaffold material rental: approx PKR 25-40/piece/day for standard components

## Key Takeaways
- A scaffolder is responsible for the safety of every worker who steps onto the platform
- Always inspect components before erection — never use damaged tubes, boards, or couplers
- Guardrails and toe boards are mandatory, not optional — they save lives
- Tie the scaffold to the building at specified intervals — an unsecured scaffold can collapse in wind
- Get trained and certified through NAVTTC/KPTEVTA — formal training dramatically reduces accidents`,

  'rigger': `# Rigging & Load Handling Fundamentals

## Introduction
Rigging involves the safe lifting, moving, and positioning of heavy loads using cranes, hoists, and manual rigging equipment. In Pakistan's construction and industrial sectors — from steel erection in Islamabad high-rises to equipment installation in KPK's industrial zones — qualified riggers ensure that every lift is planned, executed safely, and compliant with safe working practices. NAVTTC rigging certification is increasingly required on major projects.

## Essential Rigging Equipment

### Slings
- **Wire Rope Slings**: Most common for heavy construction. Available in 6×19 and 6×36 construction. Inspect for broken wires, kinks, crushing, and corrosion
- **Chain Slings**: Grade 80 alloy steel for high-temperature and abrasive environments. Check for stretch, cracks, and gouges
- **Synthetic (Web) Slings**: Polyester webbing for lighter loads and finished surfaces. Never use near heat, sharp edges without protection, or chemicals
- **Round Slings**: Endless polyester core in protective sleeve — gentle on loads, color-coded by capacity

### Hardware
- **Shackles**: Bow (omega) type and D-type. Always use the correct pin — never substitute bolts for shackle pins
- **Hooks**: Must have safety latches. Inspect for throat opening, twist, and tip wear
- **Turnbuckles**: For tensioning guy wires and adjusting rigging geometry
- **Eyebolts**: Shoulder type for angular loading, plain (un-shouldered) for vertical lifts only

## Sling Angle Factor
The load on each sling leg increases dramatically as the sling angle decreases:
- **90° (vertical)**: Sling carries 100% of rated capacity
- **60°**: Sling carries 115% — slight increase
- **45°**: Sling carries 141% — significant increase
- **30°**: Sling carries 200% — double the load! Never rig below 30°

## Rigging a Basic Load — Step by Step
1. **Determine load weight**: Check documentation, weigh, or calculate (Volume × Density). Never guess
2. **Find center of gravity**: Load must hang level. Unbalanced loads swing and are extremely dangerous
3. **Select slings**: Choose sling type and capacity based on load weight, sling angle, and environment
4. **Inspect all equipment**: Check slings, shackles, and hooks before every lift
5. **Attach slings**: Use correct hitch — choker, basket, or vertical. Protect slings from sharp edges with corner protectors
6. **Signal crane operator**: Use standard hand signals or radio communication. Only one designated signal person per lift
7. **Trial lift**: Raise load just 150-300mm off the ground. Check balance, sling security, and clearances
8. **Complete lift**: Proceed slowly with controlled movements. Keep all personnel clear of suspended loads

## Safety Warnings
- NEVER stand or walk under a suspended load — this is the #1 rigging safety rule
- Never wrap wire rope slings around bare hooks — always use proper fittings
- Inspect all rigging equipment before each use — remove damaged gear from service immediately
- Know the Working Load Limit (WLL) of every piece of equipment — never exceed it
- Wind is a major hazard — suspended loads act as sails. Stop lifting operations when wind exceeds 30 km/h

## Pakistani Context
- Rigging equipment available from industrial suppliers in Karachi, Lahore, and Islamabad
- Many Pakistani construction sites lack certified riggers — this creates a significant safety gap and a career opportunity
- NAVTTC rigging courses include crane signaling, load calculation, and equipment inspection
- Wages for qualified riggers (2026): PKR 1,500-3,000/day on industrial projects

## Key Takeaways
- Every lift must be planned — know the weight, select the right equipment, and communicate clearly
- Sling angles below 45° dramatically increase sling loading — always calculate the angle factor
- Inspect all equipment before every lift — one failed shackle can drop tonnes of steel
- Standard hand signals are universal — learn and use them consistently
- A qualified rigger prevents accidents and saves lives — take certification seriously`,

  'crane-operator': `# Crane Operation Fundamentals — Mobile & Tower Cranes

## Introduction
Crane operators are among the most skilled and highly paid tradespeople on any construction site. In Pakistan, rapid urbanization and infrastructure development (CPEC projects, motorways, housing schemes) have created strong demand for qualified crane operators. NAVTTC certification covers mobile hydraulic cranes, tower cranes, and overhead gantry cranes. Safe crane operation requires understanding load charts, rigging principles, ground conditions, and strict adherence to operational safety.

## Types of Cranes in Pakistani Construction

### Mobile Hydraulic Cranes
- **Truck-mounted**: 25-100 tonne capacity, most common on Pakistani construction and industrial sites
- **Rough terrain**: 4WD capability for off-road and unprepared ground — used in dam and highway projects
- **All-terrain**: Combines road travel speed with off-road capability — premium machines
- **Popular in Pakistan**: Tadano, XCMG, Zoomlion, Sany — Chinese manufacturers dominate the market

### Tower Cranes
- **Hammerhead (horizontal jib)**: Standard on high-rise building sites in Islamabad, Lahore, Karachi
- **Luffing jib**: Jib angle adjusts — used in congested areas where horizontal jib would oversail adjacent properties
- **Capacity**: Typically 6-16 tonnes at minimum radius, reducing with distance from mast

## Load Chart Fundamentals
The load chart is the most critical document for a crane operator:
- **Radius**: Distance from center of rotation to the load — as radius increases, capacity decreases
- **Boom length**: Longer boom = less capacity at the same radius
- **Quadrant**: Some cranes have different capacities over the front vs. side vs. rear
- **Ground conditions**: Outriggers must be fully extended on firm ground with adequate bearing capacity

### Reading a Load Chart Example
For a 50-tonne mobile crane with 30m boom:
- At 10m radius: capacity might be 18 tonnes
- At 15m radius: capacity drops to 10 tonnes
- At 20m radius: capacity drops to 6 tonnes
- **Never exceed 80% of chart capacity** for safety margin (many sites use 75%)

## Pre-Operation Checks
1. Walk around the crane — check for leaks, damage, loose bolts, tire condition (mobile cranes)
2. Check all fluid levels: hydraulic oil, engine oil, coolant
3. Test all controls and safety devices: load moment indicator (LMI), anti-two-block, swing brake
4. Verify outrigger pads are on solid, level ground — use timber mats on soft soil
5. Check wind speed — most cranes have operational limits of 35-45 km/h
6. Review lift plan — know the load weight, radius, boom configuration, and ground conditions

## Safety Warnings
- Never exceed the rated capacity on the load chart — crane tip-over is almost always fatal
- Maintain safe distance from overhead power lines — minimum 6m from 11kV lines (WAPDA/PESCO requirement)
- Do not operate crane on soft or sloping ground without engineering assessment
- Never leave a suspended load unattended — the operator must remain at controls during any lift
- In Pakistan's seismic zones (KPK, northern areas), tower cranes require specific base design and anchoring

## Pakistani Context
- Crane operator licensing: Currently no national licensing scheme, but NAVTTC certification is increasingly required by major contractors
- CPEC and industrial projects offer high wages: PKR 80,000-150,000/month for qualified operators
- Most cranes in Pakistan are Chinese-made — familiarize yourself with XCMG and Zoomlion controls and documentation
- Ground bearing capacity is often poor on alluvial soils in Punjab and Sindh — always verify with a geotechnical report before setting up

## Key Takeaways
- The load chart is your bible — never lift without checking it for the exact configuration
- Ground conditions are as important as crane capacity — a crane on weak ground will tip over even within chart limits
- Pre-operation checks prevent breakdowns and accidents — never skip them
- Maintain power line clearance — electrocution from crane contact with lines is a leading cause of fatality in Pakistan
- Communication with rigger and banksman must be clear — use standard signals and never lift on unclear instructions`,

  'heavy-driver': `# Heavy Vehicle Driving — Professional Standards for Pakistani Roads

## Introduction
Heavy vehicle drivers (HTV license holders) are the backbone of Pakistan's logistics and construction sectors. From transporting construction materials across KPK to long-haul freight on the motorway network, professional heavy driving requires mastery of vehicle handling, load securing, road safety regulations, and defensive driving techniques. NAVTTC heavy driver training programs produce qualified operators for trucks, trailers, dumpers, and specialized construction vehicles.

## Vehicle Categories in Pakistan
- **HTV (Heavy Transport Vehicle)**: Trucks above 6 tonnes — requires HTV license from relevant Motor Vehicle Examiner
- **Articulated (Trailer)**: Tractor-trailer combinations — requires additional trailer endorsement
- **Dumpers/Tippers**: Construction site vehicles for earthmoving — specific operating training required
- **Tankers**: Specialized vehicles for liquid cargo (fuel, chemicals, water) — ADR equivalent training recommended

## Pre-Trip Inspection (Daily)
Before starting any trip, walk around the vehicle and check:
1. **Tires**: Pressure, tread depth (minimum 1.6mm), cuts, bulges. Pakistan's hot roads cause rapid tire degradation — check twice daily in summer
2. **Lights**: Headlights, brake lights, indicators, hazard lights, reverse lights — all must work
3. **Brakes**: Test service and parking brakes. Check brake fluid level and air pressure (for air brakes, wait for full pressure before moving)
4. **Fluids**: Engine oil, coolant, power steering fluid, windshield washer
5. **Mirrors**: Clean and properly adjusted — you must see both sides of the trailer
6. **Load**: Confirm cargo is properly secured with chains, straps, or ropes. Check weight does not exceed axle limits

## Driving Techniques

### Gear Shifting (Non-Synchro Gearboxes)
Many Pakistani trucks still use non-synchromesh (crash) gearboxes:
- **Double-clutch upshift**: Clutch, neutral, release clutch, pause, clutch, next gear
- **Double-clutch downshift**: Clutch, neutral, release clutch, rev engine to match speed, clutch, lower gear
- Practice until shifts are smooth — grinding gears destroys the gearbox

### Mountain Driving (KPK & Northern Areas)
- Use engine braking on descents — shift to lower gear before the slope, not during
- Never ride the brakes on long descents — brake fade causes complete brake failure
- On Karakoram Highway and KPK mountain roads, always give right of way to uphill traffic
- Use horn before blind corners — standard practice on Pakistani mountain roads

### Defensive Driving
- Maintain following distance of at least 4 seconds at highway speeds (more in rain)
- Anticipate hazards: animals, pedestrians, motorcycles cutting in, slow-moving vehicles without lights
- On GT Road and motorways, watch for vehicles entering from wrong side — unfortunately common in Pakistan

## Safety Warnings
- Overloading is the #1 cause of heavy vehicle accidents in Pakistan — never exceed legal weight limits
- Fatigue kills — mandatory rest of 30 minutes after every 4 hours of driving (NHA requirement)
- Never drive under the influence of any substance — zero tolerance
- Secure all loads properly — loose cargo kills other road users
- On motorways, maximum speed for heavy vehicles is 100 km/h (80 km/h for laden trailers)

## Pakistani Context
- HTV license process: Medical fitness certificate, written test, practical driving test at Motor Vehicle Examiner office
- NHA weighbridge stations check axle loads — fines for overloading range from PKR 5,000-50,000
- Motorway Police enforce strict standards — maintain lane discipline and use indicators
- Diesel costs (2026 estimate): PKR 290-320/liter — fuel-efficient driving saves significant costs on long hauls
- NLC, CPEC logistics, and private fleet companies offer structured employment for certified drivers

## Key Takeaways
- Pre-trip inspection is mandatory, not optional — it takes 15 minutes and prevents breakdowns and accidents
- Mountain driving requires specific skills — engine braking and correct gear selection save lives
- Overloading damages roads, tires, brakes, and suspensions — and is the leading cause of crashes
- Professional driving means defensive driving — anticipate hazards before they become emergencies
- NAVTTC certification improves employability and opens doors to formal sector jobs with better pay and conditions`,

  'shuttering-carpenter': `# Formwork & Shuttering — Pakistani Construction Practice

## Introduction
Shuttering carpentry (formwork) is the trade of constructing temporary molds into which concrete is poured and allowed to set. In Pakistan, shuttering carpenters are essential on every concrete construction project — from residential houses in KPK to high-rise towers in Islamabad. The quality of formwork directly determines the quality, strength, and appearance of the finished concrete structure. NAVTTC-certified shuttering carpenters understand both traditional timber formwork and modern system formwork.

## Types of Formwork Used in Pakistan

### 1. Traditional Timber Formwork
Still the most common system on small to medium Pakistani projects:
- **Sheathing**: 18mm plywood (film-faced for fair-face concrete) or 1" thick planks (takhti)
- **Studs/Joists**: 2"×3" or 3"×4" kail (pine) or sheesham timber
- **Walers**: Horizontal members supporting studs — 4"×4" timber or steel channels
- **Props**: Adjustable steel props (5' to 12') or traditional wooden ballies (bamboo/timber poles)
- **Tie rods**: Hold opposite wall forms together against concrete pressure — 12mm or 16mm threaded rods with she-bolts

### 2. System Formwork (Manufactured)
Used on large commercial and infrastructure projects:
- **Table forms**: For flat slab construction — lifted and repositioned by crane
- **Column forms**: Adjustable steel or aluminum forms for standard column sizes
- **Wall forms**: Panel systems with quick-release clamps — MEVA, DOKA, PERI brands common on CPEC projects
- **Advantage**: Much faster cycle times, consistent quality, reusable 100+ times

## Formwork Design Basics
Concrete exerts pressure on formwork that increases with:
- **Pour height**: Maximum lateral pressure = concrete density × height (approx 24 kN/m³ × pour height in meters)
- **Pour rate**: Faster pouring = higher pressure before concrete begins to set
- **Temperature**: Hot weather (common in Pakistan) causes faster setting = lower maximum pressure
- **Vibration**: Over-vibration increases effective pressure on forms

### Typical Prop Spacing for Slabs
- 150mm slab: Props at 1.2m × 1.2m grid with 18mm plywood on 50×75mm joists at 400mm centers
- 200mm slab: Props at 1.0m × 1.0m grid
- 250mm+ slab: Requires engineering calculation — consult structural engineer

## Step-by-Step: Column Formwork
1. Clean and oil the column rebar cage area
2. Set column kickers (50mm concrete upstand) if specified
3. Build four panels to exact column dimensions minus plywood thickness
4. Apply form release agent (mould oil) to all plywood faces
5. Erect panels around rebar cage and clamp with column clamps at 400-600mm spacing
6. Check plumb with spirit level on two faces — adjust before tightening
7. Brace with raking props (minimum two directions) to prevent movement during pour
8. Check dimensions, plumb, and alignment one final time before concrete pour

## Safety Warnings
- Formwork collapse is one of the most dangerous events on a construction site — ensure all props and braces are secure
- Never walk on freshly struck (removed) formwork areas until confirmed safe
- Wear hard hat and safety boots at all times — falling timber and nails are constant hazards
- Do not remove props or formwork until concrete has reached required strength (minimum 7 days for slabs at normal temperature)
- Steel props must be on firm base — use sole plates on soft ground, never directly on soil

## Pakistani Context
- Plywood prices (2026): 18mm film-faced imported approximately PKR 4,500-6,500/sheet. Local 18mm commercial ply PKR 2,500-4,000/sheet
- Adjustable steel props available from suppliers in Peshawar and Rawalpindi: PKR 800-1,500/piece
- Timber reuse: Good quality formwork timber can be reused 4-6 times if properly maintained and stored
- Shuttering carpenter wages (2026): PKR 1,500-2,500/day — skilled shuttering carpenters are among the highest-paid trades on site

## Key Takeaways
- Formwork quality equals concrete quality — invest time in getting it right
- Always check plumb, level, and dimensions before pouring — mistakes cannot be fixed after concrete sets
- Use form release agent on all plywood — saves plywood for reuse and gives clean concrete finish
- Never remove formwork early — follow the stripping times specified by the structural engineer
- Modern system formwork is faster and produces better results — learn both traditional and system methods`,

  'tile-fixer': `# Tile Fixing — Materials, Methods & Pakistani Standards

## Introduction
Tile fixing is one of the most visible finishing trades in Pakistani construction. A well-tiled floor or wall transforms a space, while poor tile work is immediately obvious and costly to repair. NAVTTC-certified tile fixers understand substrate preparation, adhesive selection, cutting techniques, and grouting for all tile types — from locally manufactured ceramic tiles to imported porcelain and natural stone used in premium projects.

## Tile Types Common in Pakistan
- **Ceramic tiles**: Most common for residential walls and floors. Local manufacturers (Master Tiles, Shabbir Tiles, Guocera Pakistan) produce affordable options in standard sizes (12"×12", 12"×24")
- **Porcelain tiles**: Denser, less porous, more durable. Used for floors, outdoor areas, and commercial spaces. Available in sizes up to 24"×48"
- **Vitrified tiles**: Glass-like finish, very low water absorption. Popular for living rooms and commercial areas
- **Natural stone**: Marble (Ziarat White, Badal, Sunny Grey) and granite — Pakistan has abundant natural stone resources

## Surface Preparation
The substrate must be:
1. **Clean**: Free of dust, oil, paint, loose plaster, and curing compound
2. **Sound**: Tap with a hammer — hollow sounds indicate loose plaster that must be removed
3. **Flat**: Check with a 2m straight edge. Maximum deviation of 3mm for adhesive fixing, 6mm for thick-bed mortar
4. **Cured**: New cement plaster must cure for minimum 14 days before tiling
5. **Primed**: Apply bonding primer on smooth concrete surfaces to improve adhesion

## Fixing Methods

### Cement-Sand Mortar (Traditional Pakistani Method)
- Mix: 1:3 or 1:4 (cement:sand) with water to thick paste consistency
- Apply butter coat (thin slurry) to tile back, then bed on mortar
- Suitable for ceramic tiles and natural stone on floors
- **Disadvantage**: Inconsistent thickness, risk of voids behind tiles

### Tile Adhesive (Modern Method)
- Use polymer-modified cementitious adhesive (C1 or C2 grade)
- Apply with notched trowel (8-10mm notch for floors, 6mm for walls)
- Comb adhesive in one direction, then press tile into adhesive with slight twist
- **Advantage**: Consistent bond, thinner application, reduced tile hollow spots

## Safety Warnings
- Wear knee pads — tile fixers spend hours on their knees, causing long-term joint damage
- Use safety goggles and dust mask when cutting tiles — tile dust contains silica which causes lung disease
- Handle large format porcelain tiles with care — they are heavy and edges are razor sharp
- Keep work area clean — loose tiles and adhesive on floors cause slips and falls

## Pakistani Context
- Tile prices (2026): Local ceramic from PKR 60-150/sqft, porcelain PKR 120-300/sqft, imported porcelain PKR 250-800/sqft
- Pakistani marble is world-class and abundant — learn stone fixing as a premium skill
- Standard grout joint width: 2mm for rectified tiles, 3-5mm for standard tiles
- Tile cutter (manual snap cutter) available from PKR 3,000-15,000. Wet tile saw from PKR 25,000-80,000

## Key Takeaways
- Surface preparation is critical — tiles fixed on poor substrates will debond and crack
- Use the correct adhesive for the tile type — porcelain requires C2 adhesive, not regular C1
- Always back-butter large format tiles in addition to combing adhesive on the substrate
- Check level and alignment continuously — mistakes compound with every tile laid
- Clean grout from tile faces within 15-20 minutes — dried grout is extremely difficult to remove`,

  'duct-fabricator': `# HVAC Duct Fabrication — Sheet Metal Fundamentals

## Introduction
Duct fabrication is the process of manufacturing the sheet metal ductwork that distributes conditioned air throughout buildings. In Pakistan, the rapid growth of commercial construction, shopping malls, hospitals, and industrial facilities has created strong demand for skilled duct fabricators. NAVTTC duct fabrication training covers sheet metal layout, cutting, forming, and joining to produce ductwork that meets HVAC design requirements and air-tightness standards.

## Sheet Metal Materials
- **Galvanized Steel (GI)**: Standard material for HVAC ducts in Pakistan. Available in gauges from 26 (0.55mm) to 18 (1.2mm)
- **Aluminum**: Used where weight reduction or corrosion resistance is needed — kitchens, coastal installations
- **Stainless Steel**: Laboratory, pharmaceutical, and food processing applications
- **Pre-insulated panels (PIR)**: Sandwich panels that combine duct and insulation — growing in popularity for commercial projects

## Duct Gauge Selection
| Duct Size (largest dimension) | Gauge (GI Sheet) | Thickness |
|-------------------------------|-------------------|-----------|
| Up to 300mm | 26 gauge | 0.55mm |
| 301-750mm | 24 gauge | 0.7mm |
| 751-1500mm | 22 gauge | 0.8mm |
| 1501-2250mm | 20 gauge | 1.0mm |
| Over 2250mm | 18 gauge | 1.2mm |

## Basic Duct Types

### Rectangular Duct
Most common in Pakistani commercial buildings:
- Layout by developing flat patterns of each face plus allowance for seams
- Standard Pittsburgh lock seam on longitudinal joint
- TDC (Transverse Duct Connector) or angle flange for duct-to-duct connection
- Cross-breaking (diagonal creases) for rigidity on large flat surfaces

### Round/Spiral Duct
- More efficient airflow (less friction loss) but harder to fabricate manually
- Spiral lock-seam machines produce continuous spiral duct — available in Pakistani market
- Use for main trunk lines where space permits

## Fabrication Process — Rectangular Duct
1. Read the HVAC drawing — note duct size, gauge, insulation requirements, and fitting types
2. Calculate flat pattern dimensions: each side + seam allowances (Pittsburgh lock = 25mm + 10mm)
3. Mark and cut GI sheet using hand snips, power shears, or plasma cutter
4. Form Pittsburgh lock pocket on one edge and flange on the opposite edge using hand seamers or Pittsburgh lock machine
5. Bend sheet to shape on brake press (manual or hydraulic)
6. Close Pittsburgh lock seam with hand seamers and mallet
7. Attach TDC flanges by sliding onto duct ends and securing with screws
8. Apply sealant to all seams for air-tightness

## Safety Warnings
- Sheet metal edges are razor sharp — always wear heavy-duty gloves (cut-resistant Level 5)
- Safety goggles are mandatory when cutting, drilling, or grinding sheet metal
- Hearing protection when operating power shears, brakes, and forming machines
- Keep work area organized — large sheet metal pieces can slide and cause cuts to legs and feet
- When handling large duct sections, get help — awkward shapes cause back injuries

## Pakistani Context
- GI sheet prices (2026): 24 gauge approximately PKR 350-450/kg
- Duct fabrication workshops are concentrated in industrial areas of Lahore, Karachi, and Islamabad
- Demand for duct fabricators is growing with Pakistan's commercial construction boom
- Wages (2026): PKR 1,200-2,000/day for skilled fabricators, higher on MEP contractor projects

## Key Takeaways
- Accurate layout and cutting are fundamental — mistakes waste expensive material
- Pittsburgh lock seam is the industry standard for longitudinal joints — master this technique
- Seal all joints and seams — leaky ductwork wastes energy and reduces HVAC system performance
- Choose the correct gauge for the duct size — undersized sheet will buckle and vibrate
- Duct fabrication is a skill that translates directly to Gulf employment — learn international standards alongside Pakistani practice`,

  'auto-mechanic': `# Automotive Mechanics — Engine & Vehicle Systems

## Introduction
Auto mechanics diagnose, repair, and maintain motor vehicles — from small cars and motorcycles to commercial vehicles. In Pakistan, the automotive sector is massive: millions of cars, buses, trucks, and motorcycles require regular maintenance and repair. NAVTTC auto mechanic training covers engine systems, transmission, brakes, electrical systems, and modern diagnostic techniques. With Pakistani vehicle manufacturing growing (Suzuki, Toyota, Hyundai, Changan, MG plants), qualified mechanics have excellent career prospects.

## Engine Systems Overview

### Four-Stroke Petrol Engine Cycle
1. **Intake stroke**: Piston moves down, intake valve opens, air-fuel mixture enters cylinder
2. **Compression stroke**: Both valves closed, piston moves up compressing mixture (compression ratio typically 10:1)
3. **Power stroke**: Spark plug fires, combustion pushes piston down — this is the working stroke
4. **Exhaust stroke**: Exhaust valve opens, piston moves up pushing burnt gases out

### Common Engine Problems in Pakistani Vehicles
- **Overheating**: Caused by low coolant, faulty thermostat, blocked radiator, or failed water pump. Critical in Pakistan's 40-50°C summers
- **Misfiring**: Worn spark plugs, faulty ignition coils, clogged injectors, or low compression
- **Excessive oil consumption**: Worn piston rings, valve stem seals, or turbo seal failure (common in high-mileage Pakistani vehicles)
- **Timing chain/belt failure**: Catastrophic if not replaced at manufacturer intervals — many Pakistani drivers neglect this service

## Brake System

### Disc Brakes (Front — Standard on Most Cars)
- **Components**: Brake disc (rotor), caliper, brake pads, caliper bracket
- **Inspection**: Check pad thickness (minimum 2mm), disc thickness (stamped on disc), disc surface for grooves or cracks
- **Pad replacement**: Remove caliper bolts, slide caliper off, remove old pads, push piston back with C-clamp, install new pads, refit caliper, torque bolts to specification

### Drum Brakes (Rear — Common on Pakistani Economy Cars)
- **Components**: Brake drum, shoes, wheel cylinder, return springs, adjuster
- **Common issue in Pakistan**: Drum brakes lose effectiveness in monsoon flooding — always dry brakes gently after driving through standing water

## Diagnostic Approach — The Methodical Process
1. **Listen to the customer**: What exactly is the problem? When did it start? Any recent changes?
2. **Verify the complaint**: Drive or test the vehicle yourself to confirm the reported symptom
3. **Check the basics first**: Fluid levels, battery, fuses, connections — 80% of problems have simple causes
4. **Use diagnostics**: OBD-II scanner for engine codes (most Pakistani cars are OBD-II compliant from 2005+)
5. **Test and isolate**: Use systematic testing to identify the failed component — do not guess and replace
6. **Repair and verify**: Fix the problem, clear codes, test drive, and confirm resolution

## Safety Warnings
- Always support a raised vehicle with jack stands — never work under a car on a jack alone
- Disconnect battery before working on electrical systems — prevents shorts and shocks
- Allow engine to cool before opening radiator cap — pressurized coolant causes severe burns
- Use proper ventilation when running engines indoors — carbon monoxide is odorless and deadly
- Brake dust contains harmful particulates — wear a mask when cleaning brakes

## Pakistani Context
- Most common vehicles: Suzuki Mehran/Alto, Toyota Corolla/Yaris, Honda City/Civic — learn these platforms thoroughly
- OBD-II scanners available from PKR 2,000 (basic) to PKR 50,000+ (professional) in Peshawar and Rawalpindi auto markets
- Genuine parts vs. local/copy parts: Learn to identify originals — counterfeit parts are widespread in Pakistani markets
- Auto mechanic wages (2026): PKR 25,000-60,000/month in workshops, higher at authorized dealerships

## Key Takeaways
- Systematic diagnosis saves time and money — never guess and replace parts randomly
- Regular maintenance prevents expensive repairs — educate customers about service intervals
- Check the basics first — most problems have simple causes (loose connection, low fluid, worn part)
- Safety is non-negotiable — jack stands, ventilation, and eye protection save lives
- Stay updated on modern vehicle technology — hybrid and electric vehicles are coming to Pakistan`,

  'diesel-mechanic': `# Diesel Engine Mechanics — Heavy Equipment & Commercial Vehicles

## Introduction
Diesel mechanics specialize in the repair and maintenance of diesel-powered engines used in trucks, buses, generators, construction equipment, and agricultural machinery. In Pakistan, diesel engines power the majority of commercial transport and industrial equipment. From Hino and UD trucks on the GT Road to Caterpillar generators in factories and John Deere tractors in Punjab's farmlands, diesel mechanics keep Pakistan's economy moving. NAVTTC diesel mechanic certification covers engine systems, fuel injection, turbocharging, and emissions controls.

## Diesel vs. Petrol Engine — Key Differences
- **Ignition**: Diesel uses compression ignition (no spark plugs). Compression ratio of 16:1 to 22:1 heats air to 500°C+, igniting injected fuel
- **Fuel system**: High-pressure fuel injection (200-2000 bar in modern common rail systems) vs. low-pressure port injection in petrol engines
- **Torque**: Diesel engines produce much higher torque at low RPM — essential for heavy vehicles and equipment
- **Durability**: Diesel engines are built heavier and stronger, with typical service life of 500,000-1,000,000 km in commercial vehicles

## Fuel System Types in Pakistani Vehicles

### Mechanical Injection (Older Systems)
- **Inline pump**: Bosch PE-type used in older Hino, Bedford, and UD trucks. Mechanically timed, reliable but less efficient
- **Rotary pump (VE type)**: Bosch VE distribution pump used in smaller diesel vehicles and generators. Single pump serves all cylinders
- **Maintenance**: Requires periodic calibration on a fuel pump test bench — available at specialized diesel workshops in major Pakistani cities

### Common Rail Direct Injection (CRDI — Modern Systems)
- **How it works**: High-pressure pump maintains constant rail pressure (up to 2000 bar). Electronic injectors fire individually under ECU control
- **Advantages**: Better fuel economy, lower emissions, smoother operation, multiple injection events per cycle
- **Found in**: Modern trucks (Hino 500, UD Quester), SUVs (Toyota Fortuner diesel), generators (Perkins, Cummins)
- **Caution**: Requires specialized diagnostic tools and clean fuel — Pakistani diesel quality can damage common rail systems

## Common Diesel Engine Problems
- **Hard starting in cold weather**: Glow plug failure, low compression, fuel waxing (rare in most of Pakistan except northern areas)
- **Black smoke**: Overloading, clogged air filter, worn injectors, turbo failure
- **White smoke**: Coolant entering combustion chamber (head gasket failure), low compression, faulty injector timing
- **Loss of power**: Clogged fuel filter (extremely common with Pakistani diesel quality), turbo wastegate stuck, EGR valve carbon buildup

## Safety Warnings
- Diesel fuel injection systems operate at extreme pressures — never loosen high-pressure lines while engine is running. A pinhole leak can inject fuel through skin (hydraulic injection injury — medical emergency)
- Diesel fuel is less volatile than petrol but still flammable — no smoking and keep fire extinguisher nearby
- Rotating parts (fan belts, pulleys) cause severe injuries — never reach near running engine components
- Exhaust fumes contain cancer-causing particulates — always work in ventilated areas
- Heavy engine components require hoists and proper lifting — back injuries are the most common mechanic injury

## Pakistani Context
- Diesel quality in Pakistan varies significantly — advise customers to use reputable filling stations (PSO, Shell, Total)
- Fuel filter replacement every 10,000-15,000 km is essential in Pakistan due to fuel contamination
- Generator mechanics are in constant demand — Pakistan's power shortages mean every factory and commercial building has diesel generators
- Diesel mechanic wages (2026): PKR 30,000-80,000/month in workshops, up to PKR 100,000+ for common rail specialists

## Key Takeaways
- Diesel engines rely on clean fuel at the correct pressure — most problems trace back to fuel system issues
- Never work on high-pressure fuel lines with the engine running — injection injuries are life-threatening
- Systematic diagnosis using smoke color, engine behavior, and diagnostic tools saves time and parts
- Learn both mechanical and common rail systems — Pakistan's fleet includes old and new technology
- Diesel mechanics who master modern common rail systems command premium wages in Pakistan and the Gulf`,

  'fabricator': `# Metal Fabrication — Cutting, Forming & Assembly

## Introduction
Metal fabrication is the process of cutting, shaping, and assembling metal structures and components from raw stock material. In Pakistan, fabrication workshops (locally called "workshaap" or "lohar khana") produce everything from structural steel for buildings and bridges to gates, grilles, railings, industrial equipment, and storage tanks. NAVTTC fabricator training covers technical drawing interpretation, cutting methods, forming techniques, welding, and quality control for structural and general fabrication work.

## Common Materials
- **Mild Steel (MS)**: The primary fabrication material in Pakistan. Available as plates, sheets, angles, channels, I-beams, pipes, and flat bars from local rolling mills (Amreli, Mughal, Ittefaq)
- **Stainless Steel**: Used for food processing, pharmaceutical, chemical, and architectural applications. Grades 304 (general) and 316 (marine/chemical) most common
- **Aluminum**: Lightweight fabrication for architectural features, signage, and specialized equipment
- **Structural Steel**: IS/BS specification angles, channels, and beams for building frames and industrial structures

## Cutting Methods

### Manual Cutting
- **Hacksaw**: For small sections — angles, pipes, flats up to 50mm
- **Oxy-fuel cutting**: Standard on Pakistani fabrication sites for plates and structural steel. Uses oxygen and acetylene (or LPG) to cut steel up to 300mm thick
- **Plasma cutting**: Faster, cleaner cuts than oxy-fuel for plates up to 50mm. Increasingly affordable in Pakistani workshops

### Machine Cutting
- **Angle grinder**: The most-used tool in Pakistani fabrication shops. 4", 7", and 9" grinders for cutting, grinding, and finishing
- **Band saw**: Accurate straight cuts on structural sections — essential for precision work
- **Shearing machine**: Cuts sheet metal up to 6mm in straight lines — used for high-volume production

## Forming & Bending
- **Manual bending**: Using vise, hammer, and bending forks for light sections
- **Press brake**: Hydraulic machine for precise bending of plates and sheets — essential equipment in any serious fabrication shop
- **Rolling machine**: For curving plates and sheets into cylinders — used for tanks, pipes, and curved structural elements
- **Punching and drilling**: Pillar drill for holes, punching machine for high-volume plate work

## Fabrication Process — Structural Steel Example
1. **Read drawings**: Understand dimensions, material specifications, weld symbols, and tolerances
2. **Create cutting list**: List every component with dimensions, quantity, and material specification
3. **Mark out**: Transfer dimensions to steel using scriber, tape measure, and square. Mark cut lines, hole centers, and reference points
4. **Cut**: Cut all components using appropriate method — allow 2-3mm for grinding/finishing
5. **Fit-up**: Assemble components using clamps, magnets, and tack welds. Check all dimensions and squareness before welding
6. **Weld**: Complete all welds per drawing specifications — fillet welds, butt welds, or full penetration as required
7. **Finish**: Grind welds smooth (where required), remove spatter, deburr all edges
8. **Surface treatment**: Wire brush, sand blast, or grind to remove mill scale, then apply primer paint

## Safety Warnings
- Grinding discs can shatter at high speed — always use disc guards and wear face shield
- Oxy-fuel cutting produces sparks and molten metal — clear combustible materials from the area
- Hot metal looks the same as cold metal — use gloves and assume all metal in the workshop is hot
- Noise levels in fabrication workshops exceed safe limits — wear ear protection
- Steel edges and burrs cause severe cuts — wear heavy-duty gloves during handling

## Pakistani Context
- Mild steel prices (2026): Approximately PKR 250-300/kg for structural sections, PKR 280-350/kg for plates
- Major steel markets: Shershah (Karachi), Misri Shah (Lahore), Shoba Bazaar (Peshawar)
- Pakistani fabrication workshops range from small one-man operations to large industrial facilities
- Fabricator wages (2026): PKR 1,000-2,500/day depending on skill level and project type

## Key Takeaways
- Accurate marking and cutting are the foundation of good fabrication — measure twice, cut once
- Fit-up determines weld quality — properly aligned components produce stronger, cleaner welds
- Learn to read fabrication drawings including weld symbols — this is what separates a fabricator from a general worker
- Safety equipment is not optional — grinding injuries, burns, and cuts are preventable
- Structural fabrication skills are in demand both in Pakistan and the Gulf — invest in formal certification`,

  'insulation-worker': `# Thermal & Acoustic Insulation — Materials & Application

## Introduction
Insulation workers install thermal and acoustic insulation on pipes, ducts, equipment, and building surfaces. In Pakistan, insulation is critical in industrial facilities (refineries, power plants, cement factories), commercial HVAC systems, and cold storage facilities. With rising energy costs and increasing focus on energy efficiency, the demand for skilled insulation workers is growing rapidly. NAVTTC insulation worker training covers material selection, installation techniques, safety practices, and quality standards.

## Why Insulation Matters
- **Energy saving**: A 150mm uninsulated steam pipe at 200°C loses approximately 1,500 W per meter — insulation reduces this by 90-95%
- **Personnel protection**: Hot surfaces above 60°C cause burns on contact. Insulation keeps outer surface below 50°C
- **Condensation prevention**: Cold pipe insulation prevents surface condensation that causes corrosion and water damage
- **Noise reduction**: Acoustic insulation on ducts and equipment reduces noise to acceptable workplace levels

## Common Insulation Materials in Pakistan

### Thermal Insulation
- **Mineral Wool (Rock Wool)**: Temperature range up to 750°C. Most common for pipes, ducts, and equipment in Pakistani industrial plants. Available in slabs, blankets, and pre-formed pipe sections
- **Glass Wool**: Lighter and cheaper than rock wool. Good for HVAC ducts and building walls. Temperature range up to 450°C
- **Polyurethane Foam (PUF)**: Used for cold insulation (cold stores, chilled water pipes). Excellent thermal performance but limited to temperatures below 120°C
- **Calcium Silicate**: High-temperature insulation for steam pipes and boilers (up to 1000°C). Rigid sections — heavier but very durable
- **Elastomeric Rubber (Armaflex type)**: Flexible foam for chilled water and refrigerant pipes. Self-sealing, easy to install, good vapor barrier

### Cladding (Outer Protection)
- **Aluminum sheet**: Standard cladding for outdoor and visible insulation. Available in 0.5-0.8mm thickness
- **GI sheet**: More economical alternative, used in less visible areas
- **PVC cladding**: For chilled water systems — provides vapor barrier and clean appearance

## Pipe Insulation Installation — Step by Step
1. **Prepare surface**: Clean pipe of rust, oil, and debris. Apply corrosion-resistant primer if specified
2. **Measure and cut**: Measure pipe diameter and length. Cut insulation sections to size using insulation knife or saw
3. **Apply insulation**: Fit pre-formed pipe sections (half-shells) around pipe with staggered longitudinal joints. Secure with galvanized wire or stainless steel bands at 300mm intervals
4. **Seal joints**: Apply adhesive or self-adhesive tape on all joints to prevent thermal bridges
5. **Apply vapor barrier** (for cold insulation): Essential to prevent condensation within insulation. Use vapor barrier mastic or foil-faced insulation with sealed joints
6. **Install cladding**: Measure, cut, and form aluminum or GI sheet around insulation. Overlap joints by minimum 50mm. Secure with self-tapping screws or pop rivets
7. **Seal cladding joints**: Apply sealant on all cladding joints to prevent water ingress

## Safety Warnings
- Mineral wool and glass wool fibers irritate skin, eyes, and lungs — wear long sleeves, gloves, goggles, and dust mask
- Always shower and change clothes after working with fibrous insulation materials
- Working at height on scaffolding is common for insulation workers — follow fall protection requirements
- Insulation knives are extremely sharp — cut away from your body and keep blades sharp (dull blades require more force and slip more easily)
- Some older insulation materials in Pakistani factories contain asbestos — never disturb suspected asbestos without specialist assessment

## Pakistani Context
- Rock wool insulation prices (2026): Approximately PKR 200-400/sqft depending on thickness and density
- Imported brands (Rockwool, Knauf, Isover) and local/Chinese alternatives available in Karachi and Lahore
- Industrial insulation demand is concentrated in Karachi (refineries), Punjab (textile mills, cement plants), and KPK (power plants)
- Insulation worker wages (2026): PKR 1,200-2,000/day, higher on industrial shutdown/turnaround projects

## Key Takeaways
- Correct insulation saves enormous energy costs — every gap and poorly sealed joint wastes energy
- Vapor barrier is critical for cold insulation — moisture inside insulation destroys its effectiveness
- Material selection depends on temperature range, environment, and application — there is no one-size-fits-all solution
- Personal protective equipment is essential — fiber insulation causes real health problems with prolonged exposure
- Industrial insulation is a growing field in Pakistan with good wages and Gulf employment opportunities`,

  'heavy-equipment-operator': `# Heavy Equipment Operation — Earthmoving & Construction Machinery

## Introduction
Heavy equipment operators control the large machines that shape Pakistan's landscape — excavators digging foundations in Islamabad, wheel loaders moving aggregate at quarries in KPK, bulldozers grading roads for CPEC projects, and backhoe loaders working on utility installations across the country. NAVTTC heavy equipment operator certification covers machine operation, maintenance, safety, and site awareness for the most common earthmoving equipment used in Pakistani construction.

## Common Equipment Types

### Excavator (Hydraulic)
The most versatile earthmoving machine on Pakistani sites:
- **Sizes**: Mini (1-6 tonne) for confined spaces, medium (12-25 tonne) for general construction, large (30-80 tonne) for major earthworks
- **Popular in Pakistan**: Caterpillar 320, Komatsu PC200, Hyundai HX220, XCMG XE215 (Chinese manufacturers increasingly common)
- **Applications**: Trench digging, foundation excavation, demolition, material handling, grading with tilt bucket

### Wheel Loader
- **Application**: Loading trucks, stockpiling aggregate, site cleanup
- **Sizes**: 1-5 m³ bucket capacity typical on Pakistani sites
- **Tip**: Match bucket size to truck capacity for efficient loading cycles — typically 4-5 bucket loads per truck

### Bulldozer
- **Application**: Grading, land clearing, pushing bulk material, compaction
- **Key skill**: Fine grading requires precise blade control — an experienced operator can grade to ±25mm tolerance

### Backhoe Loader (JCB)
- **Most common machine in Pakistan** — the term "JCB" is used generically for all backhoe loaders
- **Versatile**: Front loader bucket for loading, rear backhoe for digging. Can work in confined urban spaces
- **Applications**: Utility trenching, small excavation, loading, road maintenance

## Pre-Operation Checks (Daily)
1. Walk around the machine — look for leaks (hydraulic, coolant, fuel), loose bolts, damaged hoses, tire/track condition
2. Check all fluid levels: engine oil, hydraulic oil, coolant, fuel
3. Test all controls: boom, stick, bucket, swing, travel — ensure smooth operation
4. Test brakes, steering, and emergency stop
5. Check mirrors, cameras (if fitted), horn, and lights
6. Verify fire extinguisher is present and charged
7. Check ground conditions in the work area — soft ground, slopes, underground services

## Operating Techniques

### Excavator — Efficient Digging Cycle
1. Position machine on firm, level ground with tracks perpendicular to the trench line
2. Dig at full depth in one pass when possible — reduce swing angle for faster cycle times
3. Load trucks on the same side as the digging face to minimize swing (ideally <90° swing)
4. Curl bucket at the bottom of the cut for a clean, level trench floor
5. Do not swing a loaded bucket over personnel — establish an exclusion zone

## Safety Warnings
- Heavy equipment is the leading cause of construction fatalities in Pakistan — maintain exclusion zones around all operating machines
- Always wear seatbelt — rollover is the #1 cause of operator death
- Never allow unauthorized passengers — machines are designed for the operator only
- Check for underground services (gas, electric, water) before digging — contact SNGPL, PESCO/WAPDA, and local utilities
- On slopes, always drive uphill and downhill (never across a slope) to prevent rollover

## Pakistani Context
- Equipment operator training available through NAVTTC centers in Peshawar, Islamabad, and Lahore
- CPEC and NHA projects require certified operators — international contractors (Chinese, Turkish) prefer formally trained operators
- Operator wages (2026): PKR 40,000-80,000/month. Specialized operators (piling rig, crane) earn PKR 80,000-150,000/month
- Fuel consumption is a major cost — efficient operation reduces fuel use by 15-25%

## Key Takeaways
- Pre-operation checks prevent breakdowns and accidents — 15 minutes of inspection saves hours of downtime
- Smooth, efficient operation reduces fuel consumption and machine wear — avoid harsh controls
- Exclusion zones around operating equipment are non-negotiable — enforce them strictly
- Underground service strikes cause explosions, electrocution, and flooding — always check before digging
- Formal certification through NAVTTC is your passport to better employment in Pakistan and overseas`,

  'aluminium-fabricator': `# Aluminium Fabrication — Doors, Windows & Curtain Walls

## Introduction
Aluminium fabrication is the manufacturing and installation of aluminium profiles for doors, windows, curtain walls, partitions, and architectural features. In Pakistan, aluminium fabrication has largely replaced traditional timber joinery for commercial buildings and is increasingly popular in residential construction. NAVTTC aluminium fabricator training covers profile selection, cutting, machining, assembly, glazing, and installation of aluminium fenestration systems.

## Aluminium Profile Systems in Pakistan

### Sliding Windows and Doors
- Most common residential system in Pakistan
- Two or three track systems with sliding sashes
- Economical and space-efficient — no swing clearance needed
- Available in standard and heavy-duty profiles

### Casement Windows and Doors
- Hinged opening — better air-tightness and weather sealing than sliding
- Used in premium residential and commercial projects
- Requires quality hinges and multi-point locking hardware

### Curtain Wall Systems
- Non-structural glass and aluminium facades for commercial buildings
- **Stick system**: Assembled on site from individual mullions and transoms — common in Pakistan
- **Unitized system**: Pre-assembled panels lifted into place — used on high-rises in Islamabad and Karachi
- Requires engineering calculation for wind load, thermal movement, and water-tightness

### Aluminium Composite Panel (ACP)
- Aluminium skin bonded to polyethylene or fire-rated mineral core
- Used for building cladding, signage, and interior feature walls
- Requires aluminium subframe fabrication for mounting

## Fabrication Process — Sliding Window

### Tools Required
- Mitre saw (compound chop saw) with aluminium cutting blade (TCT negative rake)
- Drill press and hand drill
- Router (for drainage slots and hardware mortises)
- Assembly table with corner clamps
- Crimping tool or screw assembly system
- Sealant gun and glazing tools

### Steps
1. **Read shop drawings**: Confirm overall dimensions, profile types, glass specification, and hardware
2. **Cut profiles**: Cut frame members to size with 45° mitre for corners (or 90° butt joint depending on system). Allow for corner cleats
3. **Machine drainage slots**: Route drainage holes in bottom rail (minimum 2 per sash, 8mm × 25mm)
4. **Machine hardware mortises**: Cut recesses for locks, handles, and rollers
5. **Assemble frame**: Insert corner cleats, apply sealant, and crimp or screw corners. Check squareness by measuring diagonals (must be equal)
6. **Assemble sashes**: Same process for moving sash panels
7. **Install hardware**: Fit rollers (bottom), anti-lift blocks (top), locks, and handles
8. **Glaze**: Install glass with setting blocks (bottom), location blocks (sides), and glazing beads. Apply weather seals
9. **Install**: Fix frame to prepared opening using masonry anchors at 300mm maximum spacing. Apply perimeter sealant

## Safety Warnings
- Aluminium cutting produces sharp burrs and hot chips — wear safety goggles and gloves
- Mitre saw is the most dangerous tool in the workshop — keep hands clear, use clamps, and ensure blade guard functions
- Glass handling requires suction cups and cut-resistant gloves — glass edges cause deep lacerations
- Aluminium dust from sanding/grinding is a respiratory irritant — use dust extraction or wear dust mask
- Working at height during installation requires proper scaffolding and fall protection

## Pakistani Context
- Local aluminium profile manufacturers: Master, Techno, Younus, and Anwar (Lahore, Karachi, Islamabad)
- Profile prices (2026): Standard sliding window profiles PKR 350-600/kg, premium thermal break profiles PKR 800-1,200/kg
- Glass prices (2026): 5mm clear float PKR 80-120/sqft, 6mm tinted PKR 120-180/sqft, double glazed units PKR 350-600/sqft
- Aluminium fabricator wages (2026): PKR 1,200-2,500/day. Curtain wall specialists earn significantly more

## Key Takeaways
- Accuracy is everything — a 2mm error in cutting means the window will not square up properly
- Always check squareness by measuring diagonals after assembly — adjust before sealant sets
- Drainage is critical — blocked drainage slots cause water to enter the building during monsoon rains
- Use quality sealant at all joints and perimeter — cheap sealant fails within 1-2 years in Pakistani sun
- Curtain wall fabrication is a premium skill — invest in learning this system for top wages`,

  'safety-officer': `# Construction Safety Management — Pakistani Context

## Introduction
Safety officers are responsible for identifying hazards, implementing safety controls, conducting inspections, investigating incidents, and ensuring compliance with safety regulations on construction and industrial sites. In Pakistan, construction is among the most dangerous industries — workplace accidents are significantly underreported. NAVTTC safety officer training equips candidates with the knowledge to prevent accidents, protect workers, and create a safety culture on Pakistani construction sites.

## Legal Framework in Pakistan
- **Factories Act 1934**: Primary legislation governing industrial workplace safety (outdated but still enforced)
- **Provincial ESSI regulations**: Employees' Social Security Institution requirements for workplace safety
- **KPK Occupational Safety and Health Act**: Provincial legislation for workplace safety in Khyber Pakhtunkhwa
- **Pakistan Building Code**: Includes construction safety requirements
- **PEPA/EPA regulations**: Environmental protection requirements relevant to construction
- **International standards**: ISO 45001, OHSAS 18001 — required on international contractor projects

## Key Hazards on Pakistani Construction Sites

### Falls from Height (Leading Cause of Fatalities)
- **Control measures**: Guardrails on all edges above 2m, safety nets, personal fall arrest systems (harness + lanyard)
- **Common failures in Pakistan**: No edge protection, bamboo scaffolding without guardrails, workers on roofs without harness

### Struck by Objects
- **Control measures**: Hard hats mandatory for all site personnel, toe boards on scaffolding, exclusion zones below crane operations and overhead work
- **Common failures**: No hard hats, workers walking under suspended loads, no toe boards

### Electrical Hazards
- **Control measures**: Temporary electrical installations by qualified electrician, RCDs on all circuits, overhead line proximity procedures
- **Common failures**: Exposed wiring, no RCDs, unqualified workers making connections

### Excavation Collapse
- **Control measures**: Shoring or battering for excavations deeper than 1.2m, barriers around edges, safe access ladders
- **Common failures**: Unsupported deep trenches, workers in trenches without egress routes

## Safety Officer Daily Duties
1. **Site inspection**: Walk the entire site at least once daily. Use a checklist covering scaffolding, excavations, electrical, PPE, housekeeping, fire prevention
2. **Toolbox talks**: Conduct 10-15 minute safety briefings before work starts — focus on the day's specific hazards
3. **Permit to work**: Issue and monitor permits for hot work, confined space entry, work at height, and electrical isolation
4. **PPE monitoring**: Ensure all workers wear required PPE — hard hat, safety boots, high-visibility vest as minimum
5. **Incident investigation**: Investigate all accidents and near-misses. Use the "5 Why" technique to identify root causes
6. **Documentation**: Maintain safety records, inspection reports, training records, and incident logs

## Risk Assessment — The 5-Step Process
1. **Identify hazards**: What could cause harm? Walk the work area, review the task, consult workers
2. **Identify who is at risk**: Workers, visitors, public, adjacent properties
3. **Evaluate risk**: Likelihood × Severity = Risk Rating (High/Medium/Low)
4. **Implement controls**: Hierarchy — Eliminate > Substitute > Engineering controls > Administrative controls > PPE
5. **Review**: Monitor effectiveness and update as conditions change

## Safety Warnings for Safety Officers
- Lead by example — always wear your own PPE correctly. Workers will not follow rules that officers ignore
- Never walk past an unsafe act — correcting it immediately may save a life
- Document everything — written records protect workers and the organization
- Do not become complacent — the most dangerous time is when nothing has gone wrong for a while

## Pakistani Context
- NEBOSH IGC (International General Certificate) is the recognized safety qualification in Pakistan and the Gulf
- Safety officer salaries (2026): PKR 40,000-80,000/month domestically, significantly higher on international/Gulf projects
- Many Pakistani contractors are improving safety practices due to requirements from international clients and insurance companies
- KPTEVTA and NAVTTC safety courses provide foundational training — supplement with NEBOSH or IOSH for career advancement

## Key Takeaways
- Safety is everyone's responsibility, but the safety officer must lead and enforce it
- Falls from height are the leading killer on construction sites — edge protection saves lives
- Risk assessment is the core tool — identify hazards before they cause harm
- Toolbox talks and visible safety leadership create a safety culture over time
- Invest in recognized qualifications (NEBOSH, IOSH) — they are your passport to higher pay in Pakistan and the Gulf`,

  'cook': `# Professional Cooking — Fundamentals for Institutional & Commercial Kitchens

## Introduction
Professional cooking in institutional and commercial kitchens is a skilled trade that goes far beyond home cooking. NAVTTC cook training prepares candidates for employment in hotels, restaurants, hospitals, catering companies, construction camps, and military/paramilitary mess facilities across Pakistan and overseas. The curriculum covers food safety and hygiene, cooking methods, menu planning, kitchen organization, and the preparation of Pakistani, continental, and Gulf cuisine.

## Kitchen Organization — The Brigade System
Professional kitchens are organized for efficiency:
- **Head Chef (Executive Chef)**: Overall menu planning, costing, and kitchen management
- **Sous Chef**: Second in command — supervises daily operations
- **Chef de Partie (Section Chef)**: Manages a specific station (grill, sauce, pastry, etc.)
- **Commis Chef**: Junior cook — learning the trade under supervision
- **Kitchen Helper**: Prep work, cleaning, and basic tasks

### Kitchen Stations Common in Pakistani Hotels
- **Tandoor station**: Naan, roti, tandoori chicken, kebabs — the heart of Pakistani cuisine
- **Curry/Salan station**: Gravies, curries, daal, rice dishes
- **Grill station**: Steaks, grilled fish, BBQ items
- **Cold kitchen**: Salads, cold appetizers, fruit platters
- **Pastry section**: Desserts, breads, baked items

## Food Safety — Critical Knowledge

### Temperature Control
- **Danger zone**: 5°C to 63°C — bacteria multiply rapidly in this range
- **Cold storage**: Refrigerator at 0-5°C, freezer at -18°C or below
- **Cooking temperature**: Core temperature must reach minimum 75°C for 30 seconds to kill harmful bacteria
- **Hot holding**: Maintain cooked food above 63°C during service
- **Cooling**: Cool cooked food from 63°C to 5°C within 90 minutes maximum

### Cross-Contamination Prevention
- Separate cutting boards for raw meat (red), vegetables (green), cooked food (yellow) — color coding is standard
- Never store raw meat above cooked food or vegetables in the refrigerator
- Wash hands thoroughly for 20 seconds with soap between handling different food types
- Clean and sanitize all surfaces and equipment after contact with raw food

### Personal Hygiene
- Clean chef uniform (whites) daily
- Hair covered with chef cap or hairnet
- No jewelry (except plain wedding band) — jewelry harbors bacteria and can fall into food
- Cover all cuts and wounds with blue waterproof bandages
- Do not work when suffering from diarrhea, vomiting, or infected skin conditions

## Core Cooking Methods
- **Boiling**: Water at 100°C — rice, daal, vegetables, pasta. Most basic and most-used method in Pakistani cooking
- **Sautéing/Bhunao**: Cooking in oil over high heat with stirring — the fundamental technique for Pakistani curries and salans
- **Deep frying**: Food submerged in oil at 160-180°C — pakoras, samosas, fried fish. Oil temperature control is critical
- **Roasting**: Dry heat in oven at 180-220°C — roast chicken, vegetables, baked dishes
- **Tandoor**: Extreme radiant heat (350-480°C) — naan, tandoori chicken, kebabs. Unique to South Asian cuisine
- **Steaming**: Gentle, healthy cooking method — fish, vegetables, dim sum. Growing in popularity in modern Pakistani restaurants

## Safety Warnings
- Burns and scalds are the most common kitchen injuries — use dry cloths for handling hot items (wet cloth conducts heat instantly)
- Knife safety: Always cut on a stable cutting board, curl fingers when chopping (claw grip), carry knives pointed down at your side
- Oil fires: NEVER use water on a grease fire — it causes explosive splashing. Cover with a lid or use a fire blanket
- Wet floors cause slips — clean spills immediately and wear non-slip shoes
- Gas leaks: If you smell gas, turn off supply, ventilate the area, and do not use any electrical switches or open flames

## Pakistani Context
- Hospitality industry is growing rapidly in Pakistan — new hotels, restaurants, and catering companies creating jobs
- Pakistani cooks are in high demand in Gulf countries — construction camp, hotel, and restaurant positions
- NAVTTC cook certification covers Pakistani, continental, and basic Chinese cuisine
- Cook wages (2026): PKR 25,000-50,000/month in Pakistan, AED 1,500-3,500/month in UAE depending on position and experience

## Key Takeaways
- Food safety is the foundation — temperature control and hygiene prevent food poisoning which can be fatal
- Master the basic cooking methods — they are the building blocks for every recipe
- Kitchen organization and teamwork are essential — a disorganized kitchen is slow, wasteful, and dangerous
- Pakistani cuisine skills combined with continental and Gulf cooking knowledge make you employable worldwide
- Presentation matters — food must look as good as it tastes in professional kitchens`,

  'ac-technician': `# Air Conditioning & Refrigeration — Fundamentals for Pakistani Technicians

## Introduction
Air conditioning and refrigeration technicians install, maintain, and repair cooling systems that are essential in Pakistan's hot climate. From residential split ACs in Peshawar homes to commercial VRF systems in Islamabad offices and industrial cold storage in Punjab's food sector, AC technicians are in constant demand. NAVTTC AC technician training covers refrigeration principles, system types, installation, troubleshooting, and safe handling of refrigerants.

## Refrigeration Cycle — The Core Principle
Every AC and refrigeration system works on the same basic cycle:
1. **Compressor**: Compresses low-pressure, low-temperature refrigerant gas into high-pressure, high-temperature gas
2. **Condenser**: Hot gas releases heat to outdoor air (or water) and condenses into high-pressure liquid
3. **Expansion device**: Liquid refrigerant passes through a capillary tube or TXV (thermostatic expansion valve), dropping pressure and temperature dramatically
4. **Evaporator**: Cold, low-pressure refrigerant absorbs heat from indoor air (cooling the room) and evaporates back to gas
5. **Cycle repeats**: Low-pressure gas returns to compressor

## System Types Common in Pakistan

### Split AC (Most Common Residential)
- Indoor unit (evaporator, fan, filter) and outdoor unit (compressor, condenser, fan)
- Available from 1 ton to 3 ton for residential use (1 ton = 12,000 BTU/hr)
- Inverter technology now standard — variable speed compressor saves 30-50% electricity compared to non-inverter
- Popular brands in Pakistan: Gree, Haier, Dawlance, Orient, Kenwood, PEL

### Window AC
- Self-contained unit installed in wall opening — older technology but still used
- Being phased out in favor of split systems in Pakistani market

### VRF/VRV (Variable Refrigerant Flow)
- Commercial multi-zone system — one outdoor unit serves multiple indoor units
- Used in offices, hospitals, and commercial buildings
- Requires specialized training for installation and troubleshooting
- Brands: Daikin, Mitsubishi, LG, Samsung

### Chiller Systems
- Large commercial/industrial — produce chilled water for distribution through AHU (Air Handling Units)
- Air-cooled and water-cooled types
- Found in large buildings, hospitals, data centers, and industrial processes

## Installation — Split AC Step by Step
1. **Select indoor unit location**: Mount on internal wall, away from direct sunlight and heat sources. Minimum 15cm from ceiling, 2.1m from floor
2. **Select outdoor unit location**: Good airflow around condenser (30cm clearance on all sides), accessible for maintenance, drain for condensate
3. **Drill wall penetration**: 65-75mm hole sloping slightly downward to outside for drainage
4. **Mount indoor unit bracket**: Level, secured with proper wall plugs (use concrete anchors on Pakistani RCC construction)
5. **Mount outdoor unit**: On wall bracket or ground stand with anti-vibration pads
6. **Connect refrigerant piping**: Flare connections on copper tubing. Proper flaring is critical — poor flares are the #1 cause of refrigerant leaks
7. **Connect drainage**: PVC drain pipe from indoor unit to outside — ensure continuous downward slope
8. **Connect electrical**: Separate circuit from distribution board with MCB protection (dedicated 20A for 1.5 ton AC)
9. **Vacuum the system**: Use vacuum pump to remove air and moisture from piping (hold vacuum at -750mmHg for minimum 20 minutes)
10. **Release refrigerant**: Open service valves on outdoor unit to charge the system
11. **Test**: Run the system, check superheat/subcooling, verify cooling performance, check for leaks with electronic detector or soapy water

## Common Troubleshooting
- **AC not cooling**: Check thermostat setting, dirty filter (most common cause), low refrigerant (leak), faulty compressor capacitor
- **Water dripping from indoor unit**: Blocked drain pipe (extremely common in Pakistan due to dust), frozen evaporator coil, incorrect installation slope
- **Compressor not starting**: Check power supply, capacitor (start and run), overload protector, contactor, and compressor windings
- **High electricity bill**: Dirty condenser coil (outdoor), undersized AC for room, poor room insulation, low refrigerant charge causing compressor to run continuously

## Safety Warnings
- Refrigerants displace oxygen — never release refrigerant in confined spaces. R-410A and R-32 are asphyxiants in high concentrations
- Electrical hazards: Always disconnect power before working on any AC component. Capacitors retain charge — discharge before touching
- Working at height: Outdoor unit installation often requires ladder or scaffolding work — use fall protection for heights above 2m
- Refrigerant burns: Liquid refrigerant causes frostbite on skin contact — wear gloves when handling
- Brazing with oxy-acetylene: Fire risk — keep extinguisher nearby and purge lines with nitrogen before brazing

## Pakistani Context
- Pakistan's AC market is growing 15-20% annually due to rising temperatures and expanding middle class
- Electricity costs make inverter ACs essential — educate customers on long-term savings vs. upfront cost
- Common refrigerants: R-410A (new split ACs), R-32 (newest systems), R-22 (older systems — being phased out under Montreal Protocol)
- AC technician wages (2026): PKR 25,000-60,000/month in service companies, higher for VRF specialists
- Gulf demand for Pakistani AC technicians is strong — FM (facility management) companies in UAE, Saudi Arabia, Qatar actively recruit

## Key Takeaways
- Understanding the refrigeration cycle is fundamental — every troubleshooting step traces back to these principles
- Proper flaring and leak-free connections are the most critical installation skills — practice until perfect
- Dirty filters and condensers cause 80% of AC performance problems — educate customers about regular maintenance
- Inverter technology is now standard — learn inverter board diagnostics and programming
- AC technician skills transfer directly to Gulf employment — invest in certification and refrigerant handling qualifications`,
};


/* ─── Gulf / City & Guilds reading content for reading modules ─── */
const GULF_READING_CONTENT = {
  mason: `# Cavity Wall Construction — BS EN 1996

## Introduction
Cavity wall construction is the standard method for external walls on Gulf and international projects. Unlike the solid brick walls common in Pakistani domestic construction, cavity walls use two skins (leaves) separated by an insulated cavity to provide thermal performance, weather resistance, and structural efficiency per BS EN 1996 (Eurocode 6).

## Why Cavity Walls on Gulf Projects?
Gulf countries experience extreme temperatures (50°C+ summer surface temperatures) making thermal insulation critical. Cavity walls with insulation achieve U-values of 0.25–0.35 W/m²K, meeting Estidama and Dubai Green Building requirements. The cavity also prevents rain penetration — essential for Gulf coastal areas with high humidity and driving rain.

## Key Components
- **Inner Leaf**: Typically 200mm concrete blockwork (load-bearing) or 140mm for partitions
- **Cavity**: Minimum 50mm residual clear cavity per BS EN 1996. Total cavity width depends on insulation thickness
- **Insulation**: PIR (Polyisocyanurate) or phenolic boards fixed to inner leaf. Typical 75-100mm for Gulf climate
- **Wall Ties**: Stainless steel ties per BS EN 845-1, spaced at maximum 900mm horizontally, 450mm vertically
- **Outer Leaf**: 102.5mm facing brickwork or stone cladding. Movement joints at maximum 12m centres for clay brickwork
- **DPC/DPM**: Damp Proof Course minimum 150mm above finished ground level per BS 8215

## Movement Joints — Critical for Gulf Climate
Thermal expansion is significantly greater in Gulf climates than in temperate regions. BS EN 1996 recommends:
- Clay brickwork: Maximum 12m centres
- Concrete blockwork: Maximum 6m centres
- Gulf specification often requires closer spacing due to extreme temperature differential (night 20°C to day 50°C = 30°C range)

## Safety Requirements on Gulf Sites
- All bricklayers must hold valid safety induction card (Green Card equivalent)
- Toolbox talk attendance mandatory before shift start
- Work-at-height training required for scaffold-based bricklaying
- Heat stress management: mandatory shade breaks, hydration stations, no external work above 40°C
- PPE: hard hat, safety boots, hi-vis vest, safety glasses, gloves

## Key Takeaways
- Cavity walls are the international standard — essential skill for Gulf employment
- Thermal insulation is critical for Gulf buildings — understand U-value calculations
- Movement joints prevent cracking in extreme Gulf temperatures
- Wall ties must be stainless steel (not galvanised) for Gulf salt-air environments
- BS EN 1996 (Eurocode 6) is the reference standard — learn the key clauses`,

  electrician: `# BS 7671 — IET Wiring Regulations for Gulf Installations

## Introduction
BS 7671 (IET Wiring Regulations, 18th Edition) is the definitive standard for electrical installations in the UK and is widely adopted across the Gulf region. Dubai, Abu Dhabi, Qatar, and Saudi Arabia all reference BS 7671 as the primary electrical installation standard. Understanding BS 7671 is essential for any electrician working on Gulf construction projects.

## Structure of BS 7671
The regulations are organised into seven parts:
- **Part 1**: Scope, object, and fundamental principles
- **Part 2**: Definitions
- **Part 3**: Assessment of general characteristics (supply, load, external influences)
- **Part 4**: Protection for safety (shock, overcurrent, overvoltage, fire)
- **Part 5**: Selection and erection of equipment (wiring systems, isolation, earthing)
- **Part 6**: Inspection and testing (initial verification, periodic inspection)
- **Part 7**: Special installations (bathrooms, swimming pools, solar PV, EV charging)

## Gulf-Specific Considerations

### Ambient Temperature Correction
Gulf ambient temperatures far exceed the 30°C reference in BS 7671 cable rating tables. At 45-50°C ambient:
- Correction factor Ca drops to 0.71–0.79 (Table 4B1)
- Cables must be significantly upsized compared to UK installations
- Underground cables benefit from more stable soil temperatures

### Earthing Systems
Gulf installations commonly use TN-S or TN-C-S systems. TT systems are used in some rural areas. DEWA (Dubai), KAHRAMAA (Qatar), and SEC (Saudi) each have specific requirements for earthing arrangement and earth electrode resistance.

### Cable Selection Process
1. Determine design current (Ib) from load assessment
2. Select protective device rating (In) where In ≥ Ib
3. Apply correction factors: Ca (ambient), Cg (grouping), Ci (thermal insulation), Cc (BS 3036 fuse)
4. Determine minimum tabulated current rating: It ≥ In / (Ca × Cg × Ci × Cc)
5. Select cable from Appendix 4 tables
6. Verify voltage drop ≤ 5% (Gulf specifications often limit to 3%)

## Testing & Inspection — Part 6
Initial verification tests (in sequence):
1. Continuity of protective conductors (R1 + R2)
2. Continuity of ring final circuit conductors
3. Insulation resistance (minimum 1.0 MΩ at 500V DC)
4. Polarity verification
5. Earth fault loop impedance (Zs)
6. RCD operation (trip time within limits)
7. Prospective fault current measurement

## Key Takeaways
- BS 7671 is the Gulf electrical standard — master it for career advancement
- Always apply Gulf ambient temperature correction factors — never use UK default values
- Testing sequence matters — follow Part 6 order for safe and valid results
- DEWA, KAHRAMAA, and SEC have additional local requirements beyond BS 7671
- Keep your copy of BS 7671 on site — it is your primary reference document`,

  welder: `# AWS D1.1 & ASME IX — Gulf Welding Code Requirements

## Introduction
Gulf fabrication yards and construction sites operate to international welding codes — primarily AWS D1.1 (Structural Welding Code — Steel) and ASME Section IX (Welding Qualifications). Understanding these codes is essential for welders seeking employment with Gulf employers like Aramco, ADNOC, SABIC, and major EPC contractors.

## AWS D1.1 — Structural Welding Code
AWS D1.1 governs welding of structural steel in buildings, bridges, and other structures. Gulf construction projects routinely specify AWS D1.1 compliance.

### Key Requirements
- **Welder Qualification**: All welders must pass qualification tests per AWS D1.1 Clause 4
- **WPS (Welding Procedure Specification)**: Every welding joint must have an approved WPS
- **Prequalified Joints**: Certain joint configurations and processes are prequalified (no testing required for the procedure)
- **Visual Inspection**: All welds must pass visual inspection per Table 6.1 acceptance criteria

### Visual Inspection Criteria (AWS D1.1 Table 6.1)
- Maximum undercut: 1/32" (1mm) for statically loaded, 0.01" (0.25mm) for cyclically loaded
- No cracks allowed in any weld
- Complete fusion required at all surfaces
- Maximum porosity: per Table 6.1 based on weld size and loading

## ASME Section IX — Welding Qualifications
ASME IX is the qualification standard for pressure-containing welds (pressure vessels, boilers, piping). Gulf petrochemical projects universally require ASME IX compliance.

### Essential Variables
A change in any essential variable requires re-qualification of the WPS:
- P-number (base metal group) change
- Filler metal F-number change
- Process change (e.g., SMAW to GTAW)
- Position change beyond qualified range
- Thickness change beyond qualified range
- Electrical characteristics change (e.g., AC to DC)

### Welder Performance Qualification (WPQ)
- Welders are qualified by successfully welding test coupons
- Test coupons are subjected to bend tests and/or radiographic examination
- 6G pipe qualification covers ALL positions for plate and pipe
- WPQ expires if welder does not use the process for 6+ months

## Gulf Fabrication Yard Standards
Gulf fabrication yards (Aramco, ADNOC, SABIC approved) require:
- Full material traceability from mill certificate to installed weld
- 100% visual inspection of all production welds
- NDT (RT/UT) per project specification — typically 10-100% depending on service
- PWHT for thick-section carbon steel and alloy welds
- Comprehensive weld maps and documentation

## Key Takeaways
- AWS D1.1 for structural steel, ASME IX for pressure-containing welds
- Welder qualification is mandatory — no unqualified welding on Gulf sites
- 6G pipe qualification is the "gold standard" — qualifies all positions
- Documentation is as important as the welding itself — maintain complete records
- Material traceability is strictly enforced on Gulf projects`,

  plumber: `# BS EN 806 & BS EN 12056 — Gulf Plumbing Standards

## Introduction
Gulf plumbing installations follow British and European standards — primarily BS EN 806 (Water Supply) and BS EN 12056 (Above-Ground Drainage). Understanding these standards is essential for plumbers working on Gulf construction projects, where quality requirements are significantly higher than domestic Pakistani standards.

## BS EN 806 — Water Supply Installations

### System Types
- **Direct (mains-fed)**: Common in Gulf villas and low-rise buildings where municipal pressure is adequate
- **Indirect (tank-fed)**: Used in high-rise buildings with roof-level or basement booster tank systems
- **Boosted**: Gulf high-rise buildings use pressurised booster sets with variable speed pumps

### Pipe Sizing
BS EN 806 Part 3 provides simultaneous demand calculation methods:
- Loading units assigned to each outlet type
- Peak flow calculated using probability factors
- Pipe sized for maximum velocity (typically 2 m/s for copper, 3 m/s for plastic)

### Backflow Prevention (BS EN 1717)
Critical for Gulf installations due to complex plumbing systems:
- Category 1: Potable water (drinking quality)
- Category 2: Aesthetically changed but safe (heated water, ice machines)
- Category 3: Slight health hazard (washing machines, dishwashers)
- Category 4: Significant health hazard (WC flushing, garden irrigation)
- Category 5: Serious health hazard (chemical dosing, fire sprinkler connection)

## BS EN 12056 — Above-Ground Drainage

### System Types
- **System I**: Single stack with restricted branch lengths and pipe sizes — most economical
- **System III**: Modified single stack with restrictions — most common in Gulf residential
- **System IV**: Separate discharge stacks — used for Gulf high-rise and commercial

### Key Design Rules
- Minimum trap seal depth: 50mm (75mm for WCs)
- Maximum branch pipe length depends on system type and pipe size
- Stack must be ventilated above roof level
- Air admittance valves (AAVs) can replace open vents in certain locations

## Gulf-Specific Plumbing Considerations

### Legionella Management
- Hot water must be stored at minimum 60°C (killed at 66°C)
- Cold water must be maintained below 20°C — extremely challenging in Gulf climate
- Insulation of cold water pipes is critical to prevent temperature rise
- Dead legs (unused pipe sections) must be eliminated
- Monthly thermal monitoring at sentinel points per HSG274

### Gulf Municipality Requirements
- Dubai Municipality, Abu Dhabi DM, and KAHRAMAA each have supplementary requirements
- Solar thermal pre-heat is mandatory for domestic hot water in some Gulf states
- Water-efficient fixtures required for Gulf green building certification (Estidama, LEED)
- District cooling connection requirements vary by emirate/municipality

## Key Takeaways
- BS EN 806 and BS EN 12056 are the Gulf plumbing standards — learn the key clauses
- Backflow prevention (BS EN 1717) is critical — understand the five fluid categories
- Legionella management is a major concern in Gulf's hot climate
- Gulf high-rise plumbing requires booster systems and zoning for pressure management
- Water conservation is increasingly important — Gulf green building standards drive design`,

  hvac: `# ASHRAE Standards & Gulf Cooling Design

## Introduction
HVAC systems in the Gulf are critical infrastructure — buildings are uninhabitable without cooling for most of the year. Gulf HVAC design follows ASHRAE (American Society of Heating, Refrigerating and Air-Conditioning Engineers) standards, supplemented by local utility requirements (DEWA, KAHRAMAA, ADDC).

## Key ASHRAE Standards for Gulf
- **ASHRAE 90.1**: Energy Standard for Buildings — sets minimum efficiency requirements
- **ASHRAE 62.1**: Ventilation for Acceptable Indoor Air Quality
- **ASHRAE 55**: Thermal Environmental Conditions for Human Occupancy
- **ASHRAE Handbook — Fundamentals**: Design weather data, load calculations, psychrometrics

## Gulf Cooling Load Considerations
Gulf external design temperatures reach 50°C dry bulb / 35°C wet bulb:
- Cooling loads are 2-3× higher than temperate climates
- Solar gain through glazing is the dominant load in commercial buildings
- Thermal mass construction (concrete frame) helps moderate diurnal temperature swings
- Night-time free cooling is possible during winter months (December-February)

## District Cooling — Gulf Standard
Many Gulf developments use centralised district cooling:
- Chilled water produced at central plant (typically 4-6°C supply)
- Distributed to buildings via underground chilled water network
- Energy Transfer Stations (ETS) in each building convert district chilled water to building systems
- Metered by energy consumption (TR-hr or kWh) not water volume
- Significantly more efficient than individual building chillers

## Key Takeaways
- ASHRAE standards are the foundation for Gulf HVAC design
- Gulf cooling loads are extreme — equipment sizing must account for actual Gulf design conditions
- District cooling is standard for Gulf urban developments
- Energy efficiency is increasingly regulated — ASHRAE 90.1 compliance is mandatory
- VRF/VRV systems are popular for Gulf commercial buildings due to flexibility and efficiency`,

  'steel-fixer': `# Rebar Standards — BS 4449 & BS 8666 for Gulf Projects

## Introduction
Steel fixing (rebar installation) on Gulf construction projects follows British standards — BS 4449 for reinforcing steel specification and BS 8666 for bar scheduling. Understanding these standards is essential for steel fixers working on Gulf mega-projects where quality requirements are strictly enforced.

## BS 4449 — Reinforcing Steel Grades
- **B500A**: Cold worked steel, standard ductility. Common for slabs, foundations
- **B500B**: Hot rolled or cold worked, higher ductility. Required for seismic zones (Gulf earthquake considerations)
- **B500C**: Highest ductility class. Required for critical structures in seismic regions

## BS 8666 — Bar Scheduling
Bar schedules define every reinforcement bar: shape code, bar mark, diameter, length, quantity, and bending dimensions. Gulf fabrication yards cut and bend to BS 8666 shape codes.

## Gulf-Specific Requirements
- Material traceability: every bar must be traceable to mill certificate
- Cover monitoring: spacer blocks at maximum 1m centres, cover meter checks before concrete pour
- Minimum cover varies by exposure class (50-75mm typical for Gulf marine/aggressive environments)
- Lap lengths calculated per BS EN 1992 (Eurocode 2) — typically 40-50 bar diameters

## Key Takeaways
- BS 4449 grades and BS 8666 scheduling are the Gulf rebar standards
- Material traceability is mandatory — no unidentified steel on Gulf sites
- Cover to reinforcement is critical for durability in Gulf's aggressive environment
- Quality inspection before concrete pour includes bar size, spacing, cover, and lap length checks`,

  painter: `# Protective Coatings — BS EN ISO 12944 for Gulf Environments

## Introduction
Gulf industrial and marine environments are among the most corrosive in the world — high temperatures, humidity, salt spray, and UV radiation demand high-performance protective coating systems per BS EN ISO 12944 (Corrosion Protection of Steel Structures by Protective Paint Systems).

## Corrosivity Categories for Gulf
- **C4 (High)**: Urban and industrial areas with moderate salinity — inland Gulf cities
- **C5-I (Very High Industrial)**: Industrial areas with high humidity and aggressive atmosphere — refineries, petrochemical plants
- **C5-M (Very High Marine)**: Coastal and offshore areas with high salinity — Gulf coastline, offshore platforms
- **CX (Extreme)**: Offshore and permanently immersed structures — pipeline, marine structures

## Typical Gulf Protective Coating Systems
For C5-M (coastal Gulf) carbon steel:
1. **Surface Preparation**: Sa 2½ (near-white blast) per BS 7079 / ISO 8501
2. **Primer**: Inorganic zinc silicate 75µm or zinc-rich epoxy 75µm
3. **Intermediate**: High-build epoxy 150-200µm
4. **Topcoat**: Polyurethane or fluoropolymer 50-75µm
- **Total DFT**: 300-400µm minimum for C5-M durability class

## Key Takeaways
- Gulf corrosion protection follows BS EN ISO 12944 — mandatory for industrial painting
- Surface preparation (Sa 2½ minimum) is 80% of coating system success
- DFT (Dry Film Thickness) measurement with calibrated gauges is essential for quality control
- Gulf industrial painters earn premium wages — this is a high-value specialist skill`,

  carpenter: `# Formwork Systems for Concrete Construction — BS EN 13670

## Introduction
On Gulf construction projects, carpenters specializing in formwork (shuttering) are among the most valued tradespeople. Unlike traditional timber carpentry, Gulf site carpentry is dominated by engineered formwork systems — DOKA, PERI, MEVA, and Hunnebeck — used for high-rise towers, infrastructure, and industrial construction. All concrete works must comply with BS EN 13670 (Execution of Concrete Structures), and formwork must meet BS EN 12812 (Falsework) and BS 5975 (Code of Practice for Temporary Works).

## System Formwork on Gulf Projects

### Wall Formwork — Framed Panel Systems
- **DOKA Framax Xlife / PERI MAXIMO**: Large modular panels (2.7m × 2.4m typical) with integrated push-pull props and platform brackets
- **Assembly**: Panels connected by Framax clamps or PERI BFD bolts — no loose parts, fast cycle times
- **Crane-lifted**: Panel gangs assembled on ground, lifted into position by tower crane
- **Tie systems**: She-bolts or DW15 ties through wall at specified spacing to resist concrete pressure
- **Cycle time**: Experienced crews achieve 24-hour wall cycle on Gulf high-rise projects

### Slab Formwork — Table Systems
- **DOKA Dokaflex / PERI SKYDECK**: Aluminum beam or panel systems supported on props
- **Drophead system**: Allows early striking of panels while props remain to support slab during curing — critical for fast cycle times
- **Props**: Heavy-duty adjustable steel props (Doka Eurex, PERI PEP) rated to specific loads — never substitute unrated props
- **Typical slab cycle**: 4-5 day cycle on Gulf residential towers (pour day 1, cure, strip panels day 4, move to next floor)

### Column and Core Formwork
- **Column clamp systems**: Adjustable steel column forms for standard rectangular columns (300×300 to 1200×1200mm)
- **Climbing formwork**: Self-climbing or crane-climbed systems for lift cores and shear walls — DOKA SKE50/100, PERI ACS
- **Jump forms**: Move upward floor by floor for repetitive core construction — essential for Gulf supertall buildings

## Formwork Pressure Calculations per BS EN 12812
- Maximum lateral concrete pressure depends on pour rate, concrete temperature, and admixtures
- For conventional concrete at 20°C: P = ρ × g × H (where pour rate < 2m/hr, maximum pressure = full hydrostatic to pour height)
- Gulf temperatures (35-50°C) cause faster initial set — reducing maximum pressure compared to temperate climates
- Always verify formwork design with the temporary works engineer — never assume

## Quality Standards
- **Tolerances per BS EN 13670, Class 2**: Wall plumb ±15mm over 5m height, slab level ±15mm, section dimensions ±10mm
- **Surface finish classes**: F1 (basic), F2 (ordinary), F3 (plain — requires clean, undamaged form face), F4 (special — fair-face architectural)
- **Gulf projects typically specify F3 minimum** for exposed concrete — this demands clean, film-faced plywood and careful form maintenance

## Safety on Gulf Sites
- All formwork erection/dismantling requires a Permit to Work (PTW) and method statement
- Working at height requires harness with double lanyard when above 1.8m (OSHAD/TRAKHEES requirement)
- Formwork collapse is classified as a high-potential incident — immediate stop-work and investigation
- All temporary works must be designed by a competent temporary works coordinator (BS 5975 requirement)
- Never remove props early — follow the striking schedule approved by the structural engineer

## Key Takeaways
- System formwork is faster, safer, and produces better concrete quality than traditional timber — learn the major systems
- BS EN 13670 and BS 5975 govern all concrete and temporary works — know the key requirements
- Tolerances on Gulf projects are strict — check dimensions, plumb, and level at every stage
- Formwork carpenters who can operate system formwork efficiently earn premium Gulf wages
- Safety documentation (method statements, PTWs, risk assessments) is as important as the physical work`,

  'pipe-fitter': `# Industrial Pipe Fitting — ASME B31.3 Process Piping

## Introduction
Pipe fitting on Gulf industrial projects follows international codes, primarily ASME B31.3 (Process Piping) for refineries and petrochemical plants, and ASME B31.1 (Power Piping) for power stations. Gulf pipe fitters work with carbon steel, stainless steel, alloy steel, and non-metallic piping systems carrying fluids at pressures up to 400 bar and temperatures from -196°C (cryogenic) to 600°C+. The work demands precision, cleanliness, and strict adherence to welding and testing procedures.

## Pipe Specifications
Gulf projects use standardized pipe schedules per ASME B36.10 (carbon/alloy) and B36.19 (stainless):
- **Schedule 40 (STD)**: Standard wall thickness — most common for utility services
- **Schedule 80 (XS)**: Extra strong — higher pressure applications
- **Schedule 160 / XXS**: Very heavy wall — high-pressure process piping
- Pipe sizes designated by NPS (Nominal Pipe Size): NPS 0.5" to NPS 48" common on Gulf projects

## Pipe Joining Methods

### Butt Weld
- Standard for NPS 2" and above in process piping
- Requires root gap, alignment (hi-lo tolerance per ASME B31.3: max 1.6mm), and tack welding before full weld
- All butt welds subject to NDT (Non-Destructive Testing): Radiography (RT), Ultrasonic (UT), or both

### Socket Weld
- Used for NPS 2" and below
- Pipe inserted into socket with 1.6mm gap (prevents bottoming — avoids stress concentration)
- Fillet weld around the joint — minimum 2 passes

### Flanged Connections
- Bolted flanges per ASME B16.5 (NPS 0.5" to NPS 24") and B16.47 (NPS 26" to NPS 60")
- Flange ratings: 150#, 300#, 600#, 900#, 1500#, 2500# — must match piping class specification
- Gasket selection: Spiral wound (most common on Gulf process plants), ring-type joint (RTJ) for high-pressure, PTFE for chemical service
- Bolt tightening: Star/cross pattern, torque wrench required, per client-specified procedure

### Threaded Connections
- Limited to NPS 2" and below for utility services (instrument air, water, drains)
- Use Teflon tape or thread sealant rated for service temperature and media
- Not permitted on hydrocarbon or high-pressure services on most Gulf projects

## Pipe Fit-Up Procedure
1. **Review isometric drawing**: Understand routing, elevations, supports, and weld joint details
2. **Verify materials**: Check pipe and fitting heat numbers against Material Test Certificates (MTCs)
3. **Cut and prepare**: Cut pipe square, bevel ends per WPS (Welding Procedure Specification) — typically 30° bevel with 1.6mm root face
4. **Clean surfaces**: Wire brush or grind 25mm back from weld edge. For stainless steel, use dedicated stainless steel brushes (no carbon steel contamination)
5. **Align and tack**: Use internal or external line-up clamps. Check alignment with straight edge and gap with feeler gauge
6. **Root gap**: Per WPS — typically 2.4-3.2mm for manual GTAW root pass
7. **Tack weld**: Minimum 4 tacks equally spaced for NPS 4" and above, using qualified welder and approved consumables

## Safety on Gulf Industrial Sites
- All pipe fitting work in operating plants requires a Permit to Work (PTW) — hot work, confined space, and isolation permits as applicable
- H2S (hydrogen sulfide) awareness is mandatory on Gulf oil and gas projects — know alarm levels and evacuation routes
- Lifting pipe with cranes requires a lift plan — pipe is deceptively heavy (NPS 12" Schedule 80 weighs 107 kg/m)
- All tools must be inspected and color-coded per the site's tool inspection program
- Heat stress management: Mandatory water breaks, shade rest areas, and work-rest cycles in Gulf summer

## Key Takeaways
- ASME B31.3 is the governing code for Gulf process piping — know the key requirements for fit-up, welding, and testing
- Material traceability (heat numbers, MTCs) is critical — never install unidentified material
- Fit-up alignment and root gap directly determine weld quality — invest time in getting it right
- Cleanliness is essential for stainless steel and alloy piping — carbon contamination causes corrosion failure
- Gulf pipe fitting is a premium trade — qualified fitters earn top wages in the construction hierarchy`,

  'scaffolder': `# Scaffolding — BS EN 12811 & Gulf Safety Standards

## Introduction
Scaffolding on Gulf construction and industrial projects must comply with BS EN 12811 (Temporary Works Equipment — Scaffolds), and site-specific requirements from authorities such as OSHAD (Abu Dhabi), TRAKHEES (Dubai), and MOMRA (Saudi Arabia). Gulf scaffolding operations are highly regulated, requiring documented design, competent erectors, and regular inspections. The scale of Gulf projects — supertall towers, petrochemical complexes, and infrastructure mega-projects — demands scaffolders who understand system scaffolding, suspended scaffolding, and advanced access solutions.

## Scaffolding Systems on Gulf Projects

### Tube and Coupler (BS EN 39 / BS EN 74)
- 48.3mm OD steel tubes, 4.0mm wall thickness, galvanized or painted
- Right-angle couplers (6.1 kN slip resistance), swivel couplers, sleeve couplers
- Most flexible system — adapts to any structure shape
- Standard for industrial scaffolding on refineries, power plants, and maintenance work

### System Scaffolding (Modular)
- **Ringlock (Layher Allround, Haki)**: Rosette node accepts up to 8 connections. Fast erection — 30-40% faster than tube and coupler
- **Cuplock**: Blade connection locks by gravity — very common on Gulf building sites
- **Kwikstage**: Wedge connection — simple, robust, popular on Australian-managed Gulf projects
- **Advantages**: Pre-engineered components, faster erection, reduced loose fittings, lighter weight (aluminum available)

### Suspended Scaffolding
- **BMU (Building Maintenance Unit)**: Permanently installed on completed buildings for facade maintenance
- **Gondola/Cradle**: Temporarily suspended from roof-mounted davit arms — used for facade installation and cleaning
- **Requirements**: Independent safety line, secondary suspension, over-speed governor, wind speed monitoring (cease work above 35 km/h)

## Design Requirements — BS EN 12811
- **Load classes**: Class 1 (0.75 kN/m²) inspection only, Class 3 (2.0 kN/m²) light duty, Class 5 (4.5 kN/m²) masonry, Class 6 (6.0 kN/m²) heavy duty
- **Bay lengths**: Maximum 2.4m for tube and coupler (standard), up to 3.0m for system scaffolding (depending on load class)
- **Platform width**: Minimum 600mm (W06) for access, 900mm (W09) for working with materials
- **Guardrails**: Top rail 950-1100mm, intermediate rail, toe board minimum 150mm — mandatory on all working platforms
- **Ties**: Scaffold tied to structure at every 4m vertically and alternate standards horizontally (maximum 32m² per tie)

## Gulf-Specific Requirements
- **Scaffolding Permit**: Required before erection begins — includes design calculation or drawing reference
- **Scaffold Tag System**: Green tag (safe to use), Yellow tag (incomplete — not safe), Red tag (do not use — defective)
- **Daily inspection**: Before each shift by a scaffold supervisor. Weekly inspection by Scaffold Competent Person (SCP)
- **Heat stress**: Scaffolding in Gulf summer is physically demanding — mandatory hydration, work-rest cycles, and cooling PPE
- **Wind**: Gulf shamal winds can reach 70-80 km/h — sheeted scaffolding acts as a sail. Sheeting must be removed or the scaffold structurally designed for wind loading

## Safety Standards
- All scaffolders must hold CISRS (Construction Industry Scaffolders Record Scheme) or equivalent competency card — Gulf contractors require this
- Scaffolders must wear full-body harness with twin-tail lanyard during erection and dismantling (before guardrails are complete)
- Tool lanyards mandatory — a dropped spanner from 40 floors is lethal
- All scaffolding components must be inspected before use — reject damaged items
- Minimum 2 scaffolders work together — never erect or dismantle scaffolding alone

## Key Takeaways
- BS EN 12811 and local Gulf authority requirements govern all scaffolding — know the standards
- The scaffold tag system is critical — never use a red-tagged or untagged scaffold
- CISRS certification is the recognized competency card — it is your ticket to Gulf employment
- Guardrails, toe boards, and ties are non-negotiable safety features — incomplete scaffold kills
- Gulf scaffolding is physically demanding in extreme heat — maintain fitness and hydration`,

  'rigger': `# Rigging Operations — BS 6210 & International Lifting Standards

## Introduction
Rigging on Gulf projects follows international standards including BS 6210 (Code of Practice for Safe Use of Wire Rope Slings), BS EN 13414 (Steel Wire Rope Slings), BS EN 1492 (Textile Slings), and LOLER 1998 (Lifting Operations and Lifting Equipment Regulations) as commonly adopted by Gulf contractors. Gulf industrial projects — petrochemical plants, power stations, desalination facilities — involve heavy lifts that demand precision planning, certified equipment, and competent riggers.

## Lifting Equipment Standards

### Wire Rope Slings — BS EN 13414
- **Construction**: 6×19 (general purpose), 6×36 (flexible — good for choker hitches), 6×37 (extra flexible)
- **Terminations**: Flemish eye with ferrule (most common on Gulf sites), thimble and ferrule, hand spliced
- **Inspection criteria**: Reject if >10% broken wires in one rope lay, visible corrosion reducing wire diameter, kinks, bird-caging, or core protrusion
- **Certificate**: Every sling must have a current test certificate from an accredited testing house — LEEA (Lifting Equipment Engineers Association) certified

### Chain Slings — BS EN 818
- Grade 80 or Grade 100 alloy steel
- **Inspection**: Check for stretch (>3% elongation from original = reject), cracks, gouges, and corrosion at link welds
- **Advantage over wire rope**: Better for high-temperature environments (up to 200°C for Grade 80 with de-rated SWL)
- **Tags**: Every chain sling must carry a permanently attached identification tag showing SWL, grade, and certificate number

### Synthetic Slings — BS EN 1492
- **Webbing slings**: Color-coded by capacity (Purple 1t, Green 2t, Yellow 3t, Grey 4t, Red 5t, Brown 6t, Blue 8t, Orange 10t)
- **Round slings**: Same color coding, higher WLL for equivalent size
- **Restrictions**: Do not use above 100°C, protect from sharp edges (use corner protectors), avoid UV degradation (store indoors)

## Lift Planning — Gulf Requirements
Every lift on a Gulf project requires a documented lift plan proportional to the risk:

### Standard Lift (Routine, Repetitive)
- Crane capacity exceeds load by minimum 25%
- Pre-lift checklist: load weight, rigging selection, ground conditions, weather, exclusion zone
- Lift supervisor, rigger, and crane operator all briefed

### Engineered Lift (Non-Routine, Heavy, or Complex)
- Written lift plan prepared by a Lifting Engineer (usually mechanical engineer with lifting experience)
- Includes: lift study (plan and elevation views), rigging arrangement drawing, crane capacity verification at actual radius, ground bearing assessment, and risk assessment
- Required for: tandem lifts, lifts over 80% of crane capacity, lifts near live equipment, lifts in confined areas

## Sling Angle Factors — Critical Knowledge
| Sling Angle (from horizontal) | Mode Factor | Effect on Sling Load |
|-------------------------------|-------------|---------------------|
| 90° (vertical) | 1.00 | SWL at rated capacity |
| 60° | 1.16 | 16% overload per leg |
| 45° | 1.41 | 41% overload per leg |
| 30° | 2.00 | 100% overload per leg |
| Below 30° | NOT PERMITTED | Sling failure risk |

## Safety on Gulf Sites
- Lifting operations require a Permit to Work (PTW) on all Gulf industrial sites
- Appointed Person (AP) must authorize all crane lifts — the AP has ultimate responsibility
- Exclusion zone under and around the lift must be barricaded — no personnel allowed
- All rigging equipment must be color-coded to the current inspection period (typically quarterly: Green, Blue, Red, Yellow)
- Banksman/signaler must be clearly identifiable (fluorescent vest) and use standard hand signals per BS 6166

## Key Takeaways
- Every piece of lifting equipment must have a valid test certificate — no certificate means no use
- Sling angle factors are not optional knowledge — they are essential for every rigging decision
- Lift planning prevents accidents — take time to plan, brief the team, and check everything before lifting
- Color-coded inspection systems ensure only current, certified equipment is used — never use out-of-date equipment
- Gulf rigging is a premium trade with strict competency requirements — LEEA and OPITO qualifications are highly valued`,

  'crane-operator': `# Crane Operations — BS 7121 & Gulf Regulatory Requirements

## Introduction
Crane operations on Gulf construction and industrial projects are governed by BS 7121 (Code of Practice for Safe Use of Cranes), and regional authorities including OSHAD (Abu Dhabi), TRAKHEES/DM (Dubai), and MOMRA/GOSI (Saudi Arabia) impose additional requirements. Gulf projects feature some of the world's largest cranes — 1,000+ tonne crawler cranes on industrial projects, luffing-jib tower cranes on supertall towers, and heavy-lift mobile cranes for plant installation. Crane operators on Gulf projects must hold recognized certifications and demonstrate competency in load chart interpretation, risk assessment, and emergency procedures.

## Crane Types on Gulf Projects

### Tower Cranes
- **Hammerhead (horizontal jib)**: Standard on Gulf high-rise projects. Capacities from 6t to 80t. Jib lengths up to 80m
- **Luffing jib**: Essential in congested Gulf city centers (Dubai Marina, Riyadh downtown) where oversailing adjacent sites is restricted
- **Internal climbing**: Crane climbs inside the building core as construction progresses — used on supertall towers (Jeddah Tower, various Dubai projects)
- **Saddle jib**: Can rotate over other crane jibs at different heights — allows multiple cranes on tight sites

### Mobile Cranes
- **All-terrain**: Liebherr, Tadano, Terex Demag — workhorses of Gulf construction. Capacities 60-1200 tonne
- **Rough terrain**: Smaller capacity (25-160t), excellent off-road capability for industrial sites and pipeline work
- **Crawler cranes**: Lattice boom, 50-3000+ tonne capacity. Essential for heavy industrial lifts (module installation, vessel erection)

## Load Chart Mastery — BS 7121 Requirements
- Operators must be able to read and interpret the specific load chart for the crane they are operating
- **Key variables**: Boom length/radius, counterweight configuration, outrigger extension (0%, 50%, 100%), ground bearing capacity, wind speed
- **Net capacity**: Gross chart capacity minus the weight of rigging tackle (slings, shackles, spreader beams)
- **Planning limit**: Gulf projects typically restrict operations to 80% of net capacity for standard lifts
- **Critical lifts** (>80% capacity or complex configuration): Require engineered lift plan with Appointed Person approval

## Gulf Regulatory Requirements

### Operator Certification
- CPCS (UK Construction Plant Competence Scheme) — widely recognized on Gulf projects
- NCCCO (National Commission for the Certification of Crane Operators — US) — required on some American-managed Gulf projects
- Gulf authority-specific licenses: OSHAD card (Abu Dhabi), DM card (Dubai)
- Annual medical fitness certificate including eyesight, hearing, and fitness for work at height

### Operational Requirements
- **Lift plan**: Required for every crane lift — standard or engineered depending on complexity
- **Appointed Person (AP)**: Must authorize all lifting operations per BS 7121
- **Crane supervisor**: Must be present during all lifting operations
- **Wind limits**: Typically 35 km/h for tower crane operations, 25 km/h for mobile crane with high boom — operator must monitor continuously
- **Anti-collision systems**: Mandatory when multiple tower cranes can interact on a site — Zoning or anti-collision systems required

## Pre-Operation Checks
1. Visual inspection of crane structure, ropes, sheaves, and hooks
2. Function test all controls: hoist, trolley/luff, slew, travel
3. Test all safety systems: Load Moment Indicator (LMI), anti-two-block, slew limit, hoist limit
4. Check wind speed indicator readings
5. Verify outrigger setup (mobile cranes): fully extended on mats with adequate ground bearing
6. Review lift plan and confirm communication with rigger/banksman

## Safety Standards
- Blind lifts (operator cannot see the load): Require dedicated signaler with radio communication — standard procedure on Gulf sites
- Proximity to power lines: Minimum clearance per local authority (typically 6-10m depending on voltage)
- Tower crane climbing/jumping operations: Specialist crew with documented method statement — high-risk activity
- No lifting during electrical storms — cranes are lightning conductors. Cease operations and evacuate cabin when lightning within 10km

## Key Takeaways
- Load chart competency is the core skill — operators who cannot read their specific chart should not operate
- BS 7121 provides the framework for safe lifting operations — Gulf authorities add local requirements on top
- CPCS or equivalent certification is mandatory — no card, no work on Gulf projects
- Wind management is critical in the Gulf — shamal winds can develop rapidly, especially in spring
- The Appointed Person system ensures every lift is authorized — respect and follow this chain of command`,

  'heavy-driver': `# Heavy Vehicle Operations — International Driving Standards for Gulf Projects

## Introduction
Heavy vehicle drivers on Gulf projects operate to significantly higher standards than typical road transport. Gulf countries — UAE, Saudi Arabia, Qatar, Kuwait, Oman — have strict traffic laws, mandatory vehicle standards, and zero tolerance for violations. Pakistani drivers working in the Gulf transport construction materials, equipment, and bulk cargo on modern highway networks, through active construction zones, and on industrial site internal roads. International driving permits, Gulf-specific licenses, and defensive driving training are standard requirements.

## Gulf Driving License Requirements
- **Conversion**: Pakistani HTV license can be converted to Gulf license in some countries (UAE, Saudi Arabia) subject to local testing
- **Categories**: Light vehicle, Heavy vehicle, Articulated vehicle, Heavy equipment — separate endorsements required
- **Medical**: Annual medical fitness certificate including eyesight test (minimum 6/9 corrected), blood pressure, and diabetes screening
- **Training**: Many Gulf employers require defensive driving certification (RoSPA, Smith System, or equivalent)

## Vehicle Types on Gulf Projects
- **Tipper/Dumper trucks**: 10-40 tonne capacity — hauling aggregate, sand, soil on construction sites
- **Flatbed/Low-loader**: Transporting steel, equipment, formwork, and plant. Require proper load securing per COP (Code of Practice)
- **Concrete mixer trucks**: Delivering ready-mix concrete — time-critical deliveries with specific route planning
- **Tanker trucks**: Water tankers (construction), fuel tankers, chemical tankers — ADR/GHS classification awareness required
- **Articulated trailers**: Long-haul transport of construction materials and prefabricated components

## Gulf Road Rules — Key Differences from Pakistan
- **Speed limits strictly enforced**: Radar cameras everywhere. Typical limits: 80 km/h urban, 100-120 km/h highway (heavy vehicles often 80 km/h on highways)
- **Lane discipline**: Mandatory — heavy vehicles restricted to right lanes on multi-lane highways (UAE, Saudi Arabia)
- **Salik/toll systems**: Electronic toll gates in UAE — vehicle must have valid tag
- **Tailgating**: Heavily penalized in all Gulf countries — maintain 4+ second following distance
- **Mobile phone use**: Strictly prohibited while driving — heavy fines and potential license suspension

## Load Securing — International Standards
On Gulf projects, load securing follows CEN standards (EN 12195):
- **Friction coefficient**: Know the friction value of your cargo on the truck bed (rubber mats increase friction)
- **Lashing capacity**: Each strap/chain has a rated lashing capacity (LC) — total must exceed the forward force (0.8 × cargo weight for emergency braking)
- **Blocking**: Use headboards, chocks, and dunnage to prevent forward movement
- **Over-height/wide loads**: Require escort vehicles, route survey, and police notification — arranged by the employer's transport department

## Driving in Gulf Conditions
- **Sand/dust storms (shamal)**: Reduce speed, use fog lights, pull over completely if visibility drops below 100m. Common in spring (March-June)
- **Extreme heat**: Vehicle tires can blow out on hot asphalt (60°C+). Check tire pressure when tires are cold (early morning). Carry water and emergency kit
- **Flash floods (wadis)**: Gulf deserts experience sudden flooding during rare rainfall — never drive through flowing water across roads
- **Ramadan driving**: Significantly increased accident rates due to fatigue and rush before iftar — extra caution required

## Safety Requirements
- Seatbelt mandatory at all times — Gulf construction sites enforce this even for short site movements
- Daily vehicle inspection (walk-around check) documented and signed before departing
- Fatigue management: Maximum 8 hours driving per shift, mandatory 30-minute rest every 4 hours — some Gulf clients use driver fatigue monitoring cameras
- Alcohol and drugs: Absolute zero tolerance in all Gulf countries — detection results in termination, imprisonment, and deportation
- Speed governors: Many Gulf construction vehicles are fitted with GPS tracking and speed limiters — tampering is grounds for immediate dismissal

## Key Takeaways
- Gulf driving standards are significantly higher than Pakistani roads — adapt your driving to match
- Vehicle inspection and load securing are documented requirements, not suggestions
- Speed camera fines accumulate against the vehicle owner (employer) — repeated violations mean termination
- Defensive driving saves lives and your career — anticipate hazards, maintain distance, control speed
- Pakistani drivers with a clean record and proper certification are valued in the Gulf — maintain that reputation`,

  'shuttering-carpenter': `# System Formwork & Temporary Works — BS 5975 & BS EN 12812

## Introduction
Shuttering carpenters (formwork carpenters) on Gulf projects work primarily with engineered system formwork rather than traditional timber. Projects across the Gulf — from Dubai's supertall towers to Saudi Arabia's NEOM mega-project — use DOKA, PERI, MEVA, and Hunnebeck systems that require specialized training. All temporary works must comply with BS 5975 (Code of Practice for Temporary Works Procedures) and BS EN 12812 (Falsework — Performance Requirements and General Design).

## Temporary Works Management — BS 5975
Gulf contractors implement a formal temporary works management system:
- **Temporary Works Coordinator (TWC)**: Responsible for overall temporary works management on the project
- **Temporary Works Designer**: Engineer who designs or verifies formwork for the specific application
- **Temporary Works Supervisor**: Foreman/supervisor who ensures formwork is erected per the design
- **Design check**: All non-standard formwork configurations require design calculation by a competent engineer
- **Permit to load**: Formwork must not be loaded (concrete poured) until inspected and approved by the TWC

## System Formwork Operations

### Wall Formwork Cycle (Typical Gulf High-Rise)
1. **Preparation**: Clean panels, apply form release agent, check all panel faces and connections
2. **Setting out**: Mark wall positions on slab per structural drawing — laser level for accuracy
3. **Erect first side**: Lift panel gang into position by crane, align to setting out marks, fix to kickers or starter bars
4. **Install reinforcement**: Steel fixers complete wall rebar to the approved bar bending schedule
5. **Close formwork**: Lift and fix second side panels, install she-bolt ties through wall at designed spacing
6. **Install platforms**: Fix working platforms and guardrails to both sides of the formwork
7. **Final check**: TWS inspects plumb (±5mm per 3m), dimensions (±10mm), alignment, and tie spacing
8. **Permit to pour**: TWC or delegate signs off — only then can concrete be placed
9. **Pour and cure**: Concrete placed per method statement, vibrated, and cured as specified
10. **Strike**: Remove formwork after minimum stripping time (typically 12-24 hours for walls depending on concrete strength gain)

### Slab Formwork with Drophead System
- Drophead props allow panel removal after 2-3 days while props remain supporting the slab for full curing (typically 7-14 days)
- This allows formwork panels to be cycled to the next floor while structural props remain
- Critical for achieving the fast floor cycles demanded on Gulf high-rise projects (4-7 day cycle)

## Quality and Tolerances — BS EN 13670
- **Formed surfaces Class F3 (plain)**: Standard Gulf requirement. Requires undamaged, clean formwork panels
- **Positional tolerance**: ±25mm for columns and walls in plan, ±15mm plumb per floor height
- **Section dimensions**: ±10mm for columns and beams, ±15mm for walls
- **Slab soffit level**: ±15mm from design level

## Safety Requirements — Gulf Specific
- Working at height is the primary hazard — full-body harness with twin-tail lanyard required during erection and striking
- Crane operations for panel lifting require a lifting plan and Permit to Work
- Formwork storage areas must be organized — panels stacked safely with edge protection on elevated stacks
- All formwork accessories (she-bolts, tie rods, clamps) must be inspected — defective items removed from service
- Heat stress: Formwork work in Gulf summer is physically demanding — mandatory hydration protocols and work-rest cycles

## Key Takeaways
- BS 5975 temporary works management is standard on all Gulf projects — understand the TWC/TWD/TWS roles
- System formwork proficiency (DOKA, PERI) is essential — attend manufacturer training when available
- Never load formwork without approval — unauthorized concrete pours risk structural failure and collapse
- Tolerances are strictly measured and documented on Gulf projects — check, record, and correct before pouring
- Fast cycle times drive Gulf project schedules — efficient formwork operations are the key to schedule success`,

  'tile-fixer': `# Tile & Stone Fixing — BS 5385 & International Standards

## Introduction
Tile and stone fixing on Gulf projects follows BS 5385 (Wall and Floor Tiling), BS EN 12004 (Adhesives for Tiles), and material-specific standards for natural stone installation. Gulf projects demand high-quality finishes — from marble lobbies in 5-star hotels to porcelain-clad facades on commercial towers and large-format stone in luxury residences. Tile fixers working in the Gulf must understand substrate preparation, adhesive technology, precision layout, waterproofing integration, and quality standards that exceed typical Pakistani residential practice.

## Tile Types on Gulf Projects
- **Large format porcelain**: 600×1200mm, 800×800mm, and slabs up to 1200×2400mm — standard on commercial Gulf projects
- **Natural stone**: Italian and Spanish marble, granite, travertine — premium residential and hospitality projects
- **Mosaic**: Glass, ceramic, and stone mosaics for pool surrounds, hammams (steam rooms), and decorative features
- **External cladding tiles**: Frost-resistant, low-absorption porcelain for building facades — must meet BS EN 14411 Group BIa
- **Anti-slip tiles**: Required for wet areas, pool decks, and external areas — tested to BS EN 13845 or DIN 51130 (R-rating system)

## Substrate Preparation — BS 5385 Requirements
- **Flatness**: Maximum 3mm deviation under a 2m straight edge for thin-bed adhesive fixing (most common on Gulf projects)
- **Moisture content**: Cement screed must have <75% relative humidity (hygrometer test) before tiling. In Gulf climate, drying is fast but adhesive selection must account for residual moisture
- **Priming**: Apply appropriate primer — general purpose on porous substrates, bonding primer on smooth/dense substrates (e.g., power-floated concrete)
- **Waterproofing**: Tanking membrane (Mapei Mapelastic, Sika, Laticrete Hydro Ban) applied before tiling in all wet areas (bathrooms, kitchens, pool areas, balconies) — this is a Gulf project standard requirement

## Adhesive Selection — BS EN 12004
- **C1**: Normal-set cementitious adhesive — interior floors and walls with moderate requirements
- **C2**: Improved cementitious adhesive — required for porcelain tiles (low absorption), external use, and large format
- **C2TE S1**: Deformable adhesive with extended open time — required for large format tiles (>600mm), heated floors, and facades
- **R (Reaction resin)**: Epoxy adhesive — chemical resistance areas, swimming pools, industrial floors
- **Back-buttering**: Mandatory for tiles >300×300mm — apply adhesive to both substrate and tile back to achieve >95% contact

## Installation — Large Format Porcelain (Gulf Standard Method)
1. **Set out**: Snap chalk lines for reference. On Gulf projects, full tile layout drawings (shop drawings) are approved before work starts
2. **Mix adhesive**: C2TE S1 to manufacturer specification — use paddle mixer for consistent mix. Do not add extra water
3. **Apply adhesive**: 12-15mm notched trowel on substrate, comb in one direction. Back-butter the tile with a thin skim coat
4. **Place tile**: Set tile into adhesive with slight sliding motion perpendicular to the comb lines (collapses ridges for full contact)
5. **Level**: Use leveling system (Raimondi, Tile Leveling System clips and wedges) — standard practice on Gulf projects for large format
6. **Spacing**: Use appropriate spacers — 1.5-2mm for rectified porcelain, 3mm for non-rectified. Ensure consistent joints
7. **Clean**: Remove adhesive from joints and tile surface immediately — dried adhesive is extremely difficult to remove from textured porcelain
8. **Grout**: After minimum 24 hours curing. Use flexible cementitious or epoxy grout as specified. Tool joints for a clean, uniform finish

## Quality Standards on Gulf Projects
- **Lippage (step between adjacent tiles)**: Maximum 1mm for tiles >300mm, maximum 0.5mm for tiles >600mm — checked with lippage gauge
- **Adhesive coverage**: Minimum 95% coverage on floors, 85% on walls — checked by lifting random tiles during installation (Gulf QA requirement)
- **Flatness**: 2mm under 2m straight edge on finished tiled surface
- **Grout joints**: Uniform width, consistent color, flush or slightly concave profile — no gaps, pinholes, or color variation

## Safety on Gulf Sites
- Knee protection is mandatory — use quality knee pads or kneeling mats. Gulf projects may run for years — protect your joints
- Silica dust from dry-cutting porcelain is extremely hazardous — wet-cutting is mandatory on most Gulf projects. Use water-fed saws or grinders with dust extraction
- Manual handling of large-format tiles (1200×2400mm porcelain slabs can weigh 60kg+) requires mechanical aids or two-person lifts
- Adhesive and grout contain cement — alkaline and irritating to skin. Wear gloves and wash hands frequently

## Key Takeaways
- Gulf tile fixing demands precision that exceeds typical residential standards — lippage, flatness, and adhesive coverage are measured and documented
- Waterproofing under tiles in wet areas is mandatory, not optional — get this right before laying a single tile
- Large format tiles require specific adhesive (C2TE S1), back-buttering, and leveling systems — standard practice on Gulf projects
- Silica dust control (wet-cutting) is a health and safety requirement — dry-cutting porcelain is not acceptable
- Natural stone and large-format porcelain skills are premium — these specializations earn the highest wages for tile fixers`,

  'duct-fabricator': `# HVAC Duct Fabrication — SMACNA & DW/144 Standards

## Introduction
HVAC duct fabrication on Gulf projects follows international standards — primarily SMACNA (Sheet Metal and Air Conditioning Contractors' National Association) from the US and DW/144 (HVAC Ductwork Specification) from the UK/BSRIA. Gulf buildings require extensive ductwork systems for air conditioning in extreme climates (50°C+ outdoor temperatures), with strict requirements for air-tightness, insulation, and fire safety. Duct fabricators who understand these standards are in high demand across the Gulf construction industry.

## Applicable Standards
- **SMACNA**: Dominant standard on Gulf MEP projects. Covers duct construction, gauges, reinforcement, hangers, and sealing
- **DW/144**: UK-based standard used by British MEP consultants common in the Gulf (Atkins, Mott MacDonald, WSP)
- **ASHRAE**: Defines duct sizing methodology, friction rates, and air velocity limits
- **BS EN 1506/1507**: European standards for circular and rectangular ductwork — referenced on some Gulf projects
- **Fire ratings**: BS 476 (fire resistance) and FM/UL listings for fire-rated ductwork and dampers

## Duct Construction — SMACNA Standards

### Sheet Metal Gauges (Galvanized Steel)
| Duct Size (largest side) | SMACNA Gauge | Thickness (mm) |
|--------------------------|-------------|----------------|
| Up to 305mm | 26 ga | 0.55 |
| 306-762mm | 24 ga | 0.70 |
| 763-1219mm | 22 ga | 0.85 |
| 1220-1828mm | 20 ga | 1.00 |
| 1829-2438mm | 18 ga | 1.30 |

### Reinforcement
Large ducts require cross-breaking, standing seams, or external angle reinforcement to prevent oil-canning (flexing):
- **Cross-breaking**: Diagonal creases pressed into duct faces — standard for ducts 457mm-1219mm
- **Standing seam (beading)**: Formed ridges on duct faces — used for larger sizes
- **Angle reinforcement**: External angle iron rings at specified intervals for the largest ducts

### Duct Sealing — Air-Tightness Classes
Gulf projects specify air-tightness per SMACNA or DW/144:
- **Seal Class A**: Transverse joints only — supply duct downstream of terminal devices
- **Seal Class B**: All transverse and longitudinal joints — supply duct from AHU to branch
- **Seal Class C**: All joints plus wall penetrations — exhaust duct and return air systems
- **Sealant**: Duct sealant (mastic) applied to all specified joints. Tape (UL-listed aluminum foil tape) as secondary seal

## Duct Fabrication Process — Gulf Workshop
1. **Read MEP drawings**: Note duct sizes, materials, insulation requirements, access doors, damper locations, and connection types
2. **Develop flat patterns**: Calculate developed lengths for each duct face plus seam allowances
3. **Cut sheet metal**: Plasma cutter for speed, power shears for straight cuts, nibblers for curved cuts
4. **Form seams**: Pittsburgh lock seam (standard longitudinal joint) using Pittsburgh lock forming machine or hand seamers
5. **Bend to shape**: Press brake for precise bends at 90° (or other angles for transitions and offsets)
6. **Assemble and close seams**: Pittsburgh lock or snap-lock closure. Rivet or screw as required
7. **Attach flanges**: TDC (Transverse Duct Connector) slide-on flanges or angle flanges bolted and sealed
8. **Install reinforcement**: Cross-break, bead, or attach angle reinforcement per SMACNA table requirements
9. **Quality check**: Verify dimensions, squareness, flange flatness, and seam integrity before dispatch to site

## Duct Insulation for Gulf Climate
- Supply air ducts: External insulation with 25-50mm glass wool or rubber foam to prevent condensation in Gulf humidity
- Outdoor ductwork: Aluminum-clad insulation to protect against UV and weather
- Kitchen exhaust: No insulation inside, fire-rated wrapping outside per local fire code
- Insulation must be vapor-sealed in Gulf climate — any break in vapor barrier causes condensation and mold growth

## Safety in Duct Fabrication
- Cut-resistant gloves (Level 5) mandatory — sheet metal edges are razor sharp
- Safety goggles when cutting, grinding, drilling, or riveting
- Hearing protection in the fabrication workshop — noise levels regularly exceed 90 dB
- Respiratory protection when grinding galvanized steel — zinc fume fever (metal fume fever) is a real hazard
- Proper manual handling technique for large duct sections — use mechanical aids for sections over 25kg

## Key Takeaways
- SMACNA and DW/144 are the governing standards — know gauge tables, reinforcement requirements, and sealing classes
- Air-tightness is critical for energy efficiency — leaky ductwork wastes cooling energy in Gulf buildings
- Vapor barrier integrity prevents condensation — a major concern in Gulf's high-humidity climate
- Precision fabrication reduces site rework — measure accurately and check dimensions before dispatch
- Gulf demand for duct fabricators is consistent — every building needs ductwork, and the Gulf builds continuously`,

  'auto-mechanic': `# Automotive Technology — International Standards & Gulf Vehicle Systems

## Introduction
Auto mechanics working in the Gulf service a diverse vehicle fleet ranging from luxury European cars (Mercedes, BMW, Land Rover) to Japanese reliability workhorses (Toyota, Nissan, Mitsubishi) and increasingly, high-performance and electric vehicles. Gulf vehicles operate under extreme conditions — ambient temperatures exceeding 50°C, sand and dust infiltration, and high-speed highway driving. Mechanics must understand modern vehicle technology including advanced diagnostics (OBD-II, CAN bus), hybrid/electric systems, and manufacturer-specific service procedures per international standards.

## Gulf Vehicle Operating Conditions
- **Extreme heat**: Engine cooling systems work harder — radiators, water pumps, and thermostats fail more frequently than in temperate climates
- **Sand and dust**: Air filters clog faster — recommend replacement every 10,000-15,000 km (vs. 20,000-30,000 km in clean environments)
- **Stop-start traffic**: Gulf city driving (Dubai, Riyadh, Doha) involves extended idling in traffic at high ambient temperatures — stresses CVT and automatic transmissions
- **High-speed driving**: Gulf highway speeds (120-140 km/h) put greater demands on tires, brakes, and suspension
- **UV degradation**: Rubber components (hoses, belts, bushings) degrade faster under intense Gulf UV radiation

## Diagnostic Systems

### OBD-II (On-Board Diagnostics)
- All Gulf-market vehicles from 2005+ have OBD-II systems (SAE J1962 connector)
- **Scan tools**: From basic code readers to advanced bi-directional tools (Autel MaxiSYS, Launch X431, Snap-on SOLUS)
- **DTC format**: P0xxx (powertrain generic), P1xxx (powertrain manufacturer-specific), B0xxx (body), C0xxx (chassis), U0xxx (network)
- **Live data**: Real-time sensor readings — essential for intermittent faults that do not store codes

### CAN Bus (Controller Area Network)
- Modern vehicles use CAN bus networking — multiple ECUs communicating on a shared data bus
- **Fault diagnosis**: A single broken CAN wire can cause multiple seemingly unrelated fault codes across different systems
- **Tools**: Oscilloscope for CAN bus signal analysis, multiplexing diagnostic software

## Key Systems — Gulf-Specific Service Notes

### Cooling System
- **Gulf specification**: Many manufacturers specify heavy-duty cooling packages for Gulf-market vehicles (larger radiators, additional fans)
- **Coolant**: Use OAT (Organic Acid Technology) or HOAT (Hybrid OAT) coolant specified by manufacturer. Do not mix types — causes gel formation and blocked passages
- **Flush interval**: Every 3-4 years or 60,000 km in Gulf conditions (more frequent than European/US recommendations)

### Air Conditioning
- AC system works at maximum capacity for 8-10 months of the year in the Gulf
- **Common failures**: Compressor clutch, condenser fan, refrigerant leaks at O-ring seals (heat cycling causes seal deterioration)
- **Refrigerant**: R-134a (older vehicles) and R-1234yf (2017+ models). Never mix — different oils and pressures
- **Performance test**: Vent temperature should reach 3-8°C above evaporator temperature in properly functioning system

### Tire Management
- Gulf road surface temperatures exceed 60°C in summer — tire pressure increases significantly (1 PSI per 5°C above baseline)
- **TPMS (Tire Pressure Monitoring System)**: Mandatory on modern Gulf vehicles — sensor battery life reduced by heat
- **Tire replacement**: Gulf heat reduces tire life by 20-30% compared to temperate climates — inspect tread depth and sidewall condition at every service

## Safety in Gulf Workshops
- Vehicle lifts must be inspected annually per local authority requirements (municipality or civil defense)
- Fire extinguishers (dry powder and CO2) mandatory in every workshop bay
- Battery charging area must be ventilated — hydrogen gas is explosive
- Hybrid/electric vehicle work requires high-voltage training (IMI Level 2/3 or equivalent) — touching HV components without training can be fatal
- Gulf summer heat in uncooled workshops is a serious health risk — hydration, fans, and work-rest cycles are essential

## Key Takeaways
- Gulf vehicle maintenance must account for extreme heat, dust, and UV — service intervals are often shorter than manufacturer's European/US recommendations
- Modern diagnostics (OBD-II, CAN bus, oscilloscope) are essential skills — guesswork is not acceptable in professional workshops
- Air conditioning competency is critical — a non-functional AC in the Gulf is a safety issue, not just comfort
- Hybrid and electric vehicles are growing in the Gulf market — invest in HV training for career longevity
- Manufacturer-specific training and certification (Toyota T-TEN, Mercedes Benz Academy, etc.) significantly increase earning potential`,

  'diesel-mechanic': `# Diesel Engine Technology — International Standards for Gulf Industrial Applications

## Introduction
Diesel mechanics on Gulf projects maintain and repair engines powering critical equipment: generators providing backup power to hospitals and data centers, heavy trucks transporting materials across desert highways, construction equipment on mega-projects, and marine engines in Gulf ports and offshore. Gulf industrial diesel work follows OEM (Original Equipment Manufacturer) procedures, and equipment operates under extreme conditions — 50°C+ ambient temperatures, sand ingress, and high-hour continuous operation (generators running 24/7 during power peaks).

## Engine Systems — Gulf Industrial Focus

### Common Rail Direct Injection (CRDI)
- Standard on all modern Gulf industrial engines: Caterpillar (C-series), Cummins (ISX, QSK), Volvo Penta, MTU, Perkins
- **Rail pressure**: 1600-2500 bar — electronically controlled by ECM (Engine Control Module)
- **Injector operation**: Piezoelectric or solenoid injectors with up to 7 injection events per combustion cycle (pilot, main, post-injection)
- **Diagnostic approach**: Use OEM diagnostic software (Cat ET, Cummins INSITE, Volvo VODIA) for fault codes, parameter monitoring, and injector coding

### Turbocharging Systems
- **Single turbo**: Standard on smaller engines — wastegate or VGT (Variable Geometry Turbo) controlled
- **Series turbo (compound)**: Two turbos in series — common on large Caterpillar and Cummins engines for Gulf power generation
- **Failure causes in Gulf**: Sand ingestion through damaged air filtration (check every service), oil starvation from extended drain intervals, heat soak after engine shutdown without cool-down period
- **Pre-trip turbo check**: Listen for whine or grinding, check for shaft play (axial and radial), inspect for oil leaks at seals

### Emissions Systems (Tier 4 / Stage V)
- Gulf is transitioning to Tier 4 / EU Stage V emissions standards on new equipment
- **DPF (Diesel Particulate Filter)**: Traps soot particles — requires periodic regeneration (active or passive). Ash cleaning every 3000-5000 hours
- **DEF/AdBlue (SCR system)**: Urea injection reduces NOx emissions. DEF tank must be kept full — running empty causes ECM to derate engine
- **EGR (Exhaust Gas Recirculation)**: Recirculates exhaust to reduce NOx — prone to carbon buildup in Gulf dust conditions

## Preventive Maintenance — Gulf Schedule
Gulf operating conditions require compressed maintenance intervals:
- **Engine oil and filter**: Every 250 hours (vs. 500 hours in temperate climates) — Gulf heat and dust degrade oil faster
- **Fuel filter**: Every 250-500 hours — Gulf diesel quality varies. Use OEM filters only — counterfeit filters cause injector damage
- **Air filter**: Inspect daily, replace as indicated by restriction gauge. In dust-storm conditions, inspect every shift
- **Coolant**: Test antifreeze/coolant concentration every 500 hours. Gulf water quality causes scaling — use demineralized water for top-up
- **Valve adjustment**: Per OEM schedule — typically every 3000-5000 hours on mechanical engines

## Troubleshooting — Systematic Approach
1. **Collect information**: What is the symptom? When did it start? Any recent maintenance or events?
2. **Check fault codes**: Connect OEM diagnostic tool and read active and logged fault codes
3. **Check the basics**: Fuel level and quality, air filter restriction, coolant level and temperature, oil level and condition
4. **Measure parameters**: Fuel pressure, boost pressure, exhaust temperature, crankcase pressure — compare to OEM specifications
5. **Isolate the system**: Use systematic testing (cut-out tests for injectors, pressure tests for fuel system, compression tests for mechanical condition)
6. **Repair and verify**: Fix the root cause (not just the symptom), clear codes, run the engine, and verify all parameters are within specification

## Safety on Gulf Sites
- Lockout/Tagout (LOTO) is mandatory before working on any engine — use personal locks and tags per site procedure
- Rotating machinery kills — never reach near running engines. Use extreme caution near fan belts, pulleys, and PTO shafts
- High-pressure fuel systems: CRDI rail pressure can be 2500 bar — a pinhole leak can penetrate skin and cause fatal hydraulic injection
- Battery banks on large generators store lethal energy — follow isolation procedures and use insulated tools
- Confined space entry for work inside large engine rooms or vessels requires a Confined Space Permit and gas testing

## Key Takeaways
- OEM diagnostic software is essential for modern diesel engines — invest in learning Cat ET, Cummins INSITE, or equivalent
- Gulf operating conditions demand compressed maintenance intervals — following temperate-climate schedules leads to premature failures
- Air filtration is critical in Gulf dust conditions — a failed air filter destroys a turbo and engine in hours
- Systematic troubleshooting using data and measurements beats guesswork — modern engines are too complex for trial-and-error
- Diesel mechanics with OEM certifications (Caterpillar, Cummins, Volvo) earn premium wages in the Gulf — pursue factory training`,

  'fabricator': `# Structural & Mechanical Fabrication — BS EN 1090 & AWS Standards

## Introduction
Metal fabrication on Gulf projects operates to international standards — primarily BS EN 1090 (Execution of Steel Structures and Aluminium Structures) for structural steel and AWS D1.1 (Structural Welding Code — Steel) for welding. Gulf fabrication encompasses structural steelwork for high-rise buildings, industrial process equipment (pressure vessels, heat exchangers, storage tanks), architectural metalwork, and mechanical piping supports. Fabrication workshops in the Gulf (UAE, Saudi Arabia, Qatar) are typically large-scale operations with advanced CNC equipment and formal quality management systems.

## Applicable Standards
- **BS EN 1090-2**: Execution of steel structures — defines Execution Classes (EXC1-4) based on consequence and hazard
- **AWS D1.1**: Structural Welding Code — dominant on American-managed Gulf projects
- **ASME Section VIII**: Pressure vessel fabrication — for oil/gas and petrochemical equipment
- **API 650**: Storage tank fabrication — welded steel tanks for oil storage (common Gulf application)
- **BS EN ISO 3834**: Quality requirements for fusion welding — required quality system for BS EN 1090 fabrication

## Execution Classes — BS EN 1090-2
- **EXC1**: Low consequence, static loading — minor structures, secondary steelwork
- **EXC2**: Medium consequence — most standard structural steelwork (typical Gulf commercial buildings)
- **EXC3**: High consequence — primary structural members, high-rise frames, bridges
- **EXC4**: Extreme consequence — special structures where failure would be catastrophic
- Each class has increasing requirements for inspection, traceability, and documentation

## Fabrication Process — Gulf Workshop

### Material Control
- All steel must have EN 10204 Type 3.1 Mill Test Certificates (MTCs) — tracing chemistry and mechanical properties to the specific heat
- Material stored off ground on painted racks, segregated by grade — no mixing of carbon steel and stainless steel
- Each piece marked with heat number using low-stress stamps or paint markers — traceability from raw material to finished product

### Cutting
- **CNC plasma/oxy-fuel**: Automated cutting from nested DXF files — minimizes material waste and ensures accuracy
- **CNC drilling lines**: Automated drilling, punching, and marking of structural sections
- **Band saw**: Structural section cutting to length with mitre capability
- **Cut quality**: Checked per BS EN ISO 9013 — surface roughness and perpendicularity must meet the specified class

### Welding
- All welding per approved WPS (Welding Procedure Specification) qualified per BS EN ISO 15614 or AWS D1.1
- Welders hold valid qualification certificates (BS EN ISO 9606 or AWS D1.1 Section 4)
- **Common processes in Gulf workshops**: SMAW (stick), GMAW/FCAW (MIG/wire), GTAW (TIG for stainless/alloy), SAW (submerged arc for heavy plate)
- **Pre-heat**: Required for thick sections (>25mm) and higher-strength steels per WPS

### Quality Control and Inspection
- **Visual inspection (VT)**: 100% of all welds — per BS EN ISO 17637
- **NDT (Non-Destructive Testing)**: Percentage and method per Execution Class — UT, MT, PT, RT as specified
- **Dimensional inspection**: All fabricated items measured against approved shop drawings using calibrated equipment
- **Documentation**: Inspection and Test Plans (ITPs), weld maps, NDT reports, material certificates — all compiled into a Manufacturer's Data Report (MDR)

## Surface Treatment for Gulf Environment
Gulf's marine and desert environment is highly corrosive:
- **Blast cleaning**: Sa 2½ (near-white blast) per ISO 8501-1 — standard for Gulf structural steel
- **Paint system**: Per BS EN ISO 12944. Typical: zinc-rich primer + epoxy intermediate + polyurethane topcoat (300-400µm total DFT for C4-C5 environments)
- **Hot-dip galvanizing**: Per BS EN ISO 1461 — used for secondary steelwork, handrails, grating, and buried structures
- **Inspection**: DFT (Dry Film Thickness) measurement per BS EN ISO 2808, adhesion testing per ISO 4624

## Safety in Gulf Fabrication Workshops
- Welding fume extraction is mandatory — local exhaust ventilation (LEV) at each welding station
- Hot work permits required for any cutting or welding outside designated workshop areas
- Overhead crane operations require trained operators and riggers — lifting is controlled by Permit to Work
- PPE: Welding helmet (auto-darkening Shade 10-13), fire-resistant clothing, safety boots, hearing protection, respiratory protection

## Key Takeaways
- BS EN 1090 and AWS D1.1 are the governing fabrication standards on Gulf projects — know the requirements for your Execution Class
- Material traceability from mill certificate to finished product is mandatory — no undocumented material is acceptable
- Welder qualifications must be current and cover the specific joint configuration, material, and process — verify before welding
- Gulf corrosion protection requirements are stringent — surface preparation and coating quality directly affect structural life
- Quality documentation (MTCs, WPS, NDT reports, ITPs) is as important as the physical fabrication — Gulf clients audit thoroughly`,

  'insulation-worker': `# Industrial Insulation — BS 5970 & ASTM Standards for Gulf Applications

## Introduction
Industrial insulation in the Gulf covers thermal insulation for high-temperature systems (steam, hot oil, exhaust), cold insulation for refrigeration and cryogenic systems (chilled water, LNG), and acoustic insulation for noise control. Gulf petrochemical plants, power stations, desalination facilities, and district cooling networks all require extensive insulation systems installed to BS 5970 (Code of Practice for Thermal Insulation of Pipework and Equipment in the Built Environment) and ASTM C585 (Inner and Outer Diameters of Rigid Thermal Insulation for Nominal Sizes of Pipe).

## Why Insulation is Critical in the Gulf
- **Energy conservation**: A 200mm uninsulated steam pipe at 300°C in Gulf ambient conditions loses approximately 2,500 W/m. Proper insulation reduces this by 95%, saving millions in fuel costs across a plant
- **Personnel protection**: Gulf OSHAD/TRAKHEES regulations require surface temperature below 60°C on any accessible hot surface — insulation achieves this
- **Process control**: Maintaining fluid temperatures within specification is essential for process efficiency
- **Condensation prevention**: Gulf humidity (70-90% RH coastal areas) causes severe condensation on cold surfaces — insulated and vapor-sealed systems prevent corrosion under insulation (CUI)
- **Noise control**: Acoustic insulation on equipment and ductwork reduces workplace noise to below 85 dB(A) per Gulf OSHA requirements

## Insulation Materials for Gulf Conditions

### Hot Insulation (Above Ambient)
- **Mineral wool (rock wool)**: BS EN 14303. Temperature range up to 750°C. Standard for pipe, vessel, and equipment insulation. Available as pre-formed pipe sections, slabs, and wired mattresses
- **Calcium silicate**: ASTM C533. Temperature range up to 1050°C. Rigid sections for high-temperature steam pipes and turbine exhaust. Excellent compressive strength for areas subject to foot traffic
- **Microporous insulation**: Ultra-low thermal conductivity — used where space is restricted or extremely high temperatures exist

### Cold Insulation (Below Ambient)
- **Polyisocyanurate (PIR)**: ASTM C591. Temperature range -180°C to +150°C. Standard for chilled water systems, refrigeration, and cryogenic applications on Gulf district cooling and LNG projects
- **Elastomeric foam (Armaflex/K-Flex)**: Flexible closed-cell foam for chilled water pipes up to 50mm diameter. Built-in vapor barrier — popular for commercial HVAC systems
- **Cellular glass (Foamglas)**: Completely impermeable — used for extreme cold applications, underground, and areas where no moisture penetration is acceptable

### Cladding and Jacketing
- **Aluminum sheet (3003 H14)**: Standard cladding for outdoor insulation in the Gulf — 0.7mm minimum thickness. Stucco-embossed finish for appearance
- **Stainless steel sheet**: Used in coastal/offshore environments where aluminum corrodes, and in food/pharmaceutical applications
- **PVC jacketing**: For cold insulation indoors — provides vapor barrier and clean finish

## Installation — Hot Pipe Insulation (Mineral Wool)
1. **Surface preparation**: Clean pipe of loose rust, grease, and debris. Apply corrosion protection paint if specified in the insulation specification
2. **Select insulation**: Match pipe size to pre-formed insulation section per ASTM C585 size chart. Verify correct density and thickness per project specification
3. **Install first layer**: Fit half-shells around pipe with staggered longitudinal and circumferential joints. Secure with 0.6mm stainless steel banding wire at 225mm intervals
4. **Install second layer** (if required for thicker insulation): Offset all joints from first layer by minimum 150mm — eliminates thermal bridging
5. **Apply vapor barrier** (cold insulation only): Wrap with vapor barrier jacket, seal all laps and joints with vapor barrier adhesive — zero tolerance for gaps in Gulf humidity
6. **Install cladding**: Measure and cut aluminum sheet to circumference plus 50mm overlap. Form and fix with self-tapping stainless steel screws. Seal all joints with silicone sealant to prevent water ingress
7. **Finish**: Install metal banding over cladding at 300mm intervals for security. Fit end caps and rain caps at terminations

## Corrosion Under Insulation (CUI) — Gulf's Major Challenge
- CUI is the most common cause of piping failure in Gulf petrochemical plants
- **Cause**: Moisture enters insulation through damaged cladding, vapor barrier failure, or condensation. Trapped moisture corrodes the pipe surface — hidden until failure occurs
- **Prevention**: Proper cladding installation with sealed joints, intact vapor barriers, and correct material selection
- **Inspection**: Regular visual inspection of cladding condition. CUI inspection programs use thermography, profile radiography, or cladding removal on susceptible areas

## Safety on Gulf Industrial Sites
- Working at height on scaffolding is constant — fall protection (harness with twin-tail lanyard) mandatory above 1.8m
- Mineral wool and glass wool fibers: Full-body coverage (long sleeves, gloves), safety goggles, and P2 dust mask mandatory
- Hot surfaces: Verify pipe temperature before working — use infrared thermometer. Wear heat-resistant gloves rated for the expected temperature
- Confined spaces: Insulation work inside vessels, ducts, and pipe racks may require Confined Space Permit and gas testing
- Knife safety: Insulation knives are extremely sharp — use retractable blade knives and cut-resistant gloves

## Key Takeaways
- BS 5970 and project insulation specifications govern all Gulf insulation work — know the material, thickness, and finish requirements
- Vapor barrier integrity is critical for cold insulation in Gulf humidity — one gap can cause complete system failure through condensation
- CUI prevention depends on quality cladding installation and maintenance — this is a major concern for Gulf asset owners
- Material selection must match the temperature range, environment, and mechanical requirements — there is no universal solution
- Gulf insulation work offers consistent, well-paid employment — every industrial and commercial project needs insulation specialists`,

  'heavy-equipment-operator': `# Heavy Equipment Operations — International Standards & Gulf Site Requirements

## Introduction
Heavy equipment operators on Gulf mega-projects control some of the largest and most advanced earthmoving and construction machinery in the world. From excavators and wheel loaders on NEOM and Red Sea Development projects in Saudi Arabia, to bulldozers and graders building new highways across the UAE, Gulf equipment operation follows strict international standards. Operators must hold recognized certifications, understand machine telematics, and work within comprehensive safety management systems that are rigorously enforced by Gulf authorities.

## Certification Requirements
- **CPCS (Construction Plant Competence Scheme)**: UK-based certification widely recognized on Gulf projects — covers specific machine categories (A59 excavator, A36 loader, A31 dozer, etc.)
- **NCCCO (National Commission for the Certification of Crane Operators)**: US-based — required on some American-managed Gulf projects
- **OPITO**: For oil and gas specific equipment operations — offshore and onshore
- **Gulf authority cards**: OSHAD (Abu Dhabi), TRAKHEES (Dubai), MOMRA (Saudi Arabia) — may require local endorsement of international cards
- **Medical fitness**: Annual medical including eyesight, hearing, musculoskeletal fitness, and drug/alcohol screening

## Machine Technology on Gulf Projects

### Telematics and GPS
- Modern Gulf fleet equipment is fitted with telematics (Cat Product Link, Komatsu KOMTRAX, Volvo CareTrack)
- **Machine monitoring**: Hours, fuel consumption, idle time, location — visible to management in real-time
- **GPS machine control**: Excavators and dozers with 3D GPS guidance — machine follows digital terrain model automatically
- **Benefit**: GPS-guided operations achieve ±25mm accuracy without survey stakes — standard on Gulf highway and grading projects

### Operator Comfort and Productivity
- Gulf fleet machines typically have enclosed, air-conditioned cabs — essential for summer operations
- Rearview cameras and radar proximity detection systems — mandatory on many Gulf sites
- Automatic ride control, auto-idle, and eco-mode — operators expected to use fuel-saving features

## Operating Standards — Gulf Sites

### Excavator Operations
- **Ground conditions**: Gulf desert soils range from loose sand to hard caprock. Sabkha (salt flats) are treacherous — low bearing capacity, high corrosion risk
- **Utility avoidance**: Underground services (water, sewer, gas, power, telecom) must be located by GPR (Ground Penetrating Radar) before excavation — hitting a live service triggers mandatory incident investigation
- **Bank stability**: Gulf sandy soils require shallower batter angles (1:1 to 1:1.5) — steeper cuts will collapse without shoring

### Dozer and Grader Operations
- **Grading tolerance**: ±25mm with GPS control, ±50mm with conventional methods — Gulf road projects are stringent
- **Material types**: Wadi gravel, imported aggregate, crusher run, subbase materials — each handles differently
- **Dust suppression**: Water trucks must operate alongside grading equipment — Gulf dust is a visibility and health hazard

### Wheel Loader Operations
- **Stockpile management**: Maintain clean, organized stockpiles — material segregation is important for quality control
- **Truck loading**: Match bucket size to truck capacity for 4-5 pass loading. Track tonnage for daily production reporting
- **Ground engagement tools (GET)**: Bucket teeth, cutting edges, and wear plates — inspect daily, replace when worn beyond manufacturer limits

## Safety Management on Gulf Sites
- **Plant/People Segregation**: Absolute separation of vehicle routes and pedestrian routes — dedicated crossing points with physical barriers
- **Exclusion zones**: Minimum 6m exclusion zone around all operating equipment — enforced by banksman/spotter
- **Reversing**: Never reverse without a spotter or functioning reversing camera/radar — most plant fatalities involve reversing vehicles
- **Emergency stop**: Know the location and operation of emergency stops — test during daily pre-start check
- **Permit to Work**: Required for equipment operations near live utilities, confined spaces, hazardous areas, and during lifting operations

## Key Takeaways
- CPCS or equivalent certification is mandatory on Gulf projects — no card means no work
- GPS machine control is the present and future of Gulf earthworks — learn this technology
- Pre-operation checks are formally documented and audited on Gulf sites — take them seriously
- Plant/people segregation saves lives — the most dangerous interaction on any site is between heavy equipment and people on foot
- Gulf mega-projects offer excellent career opportunities for skilled operators — maintain certifications and upskill continuously`,

  'aluminium-fabricator': `# Aluminium Fabrication — BS EN 12020, BS EN 14351 & Gulf Building Standards

## Introduction
Aluminium fabrication on Gulf projects encompasses fenestration (doors and windows), curtain wall systems, cladding, and architectural metalwork for some of the world's most iconic buildings. Gulf standards for aluminium fabrication are driven by extreme climate conditions — intense solar radiation, temperatures exceeding 50°C, high humidity in coastal areas, and occasional sand storms. All aluminium fenestration must comply with BS EN 14351 (Windows and Doors — Product Standard) and local authority requirements such as Estidama (Abu Dhabi), Dubai Green Building Regulations, and MODON (Saudi Arabia).

## Performance Requirements — Gulf Climate

### Thermal Performance
- Gulf building codes require maximum U-values (thermal transmittance) for fenestration:
  - Abu Dhabi (Estidama): U-value ≤ 1.9 W/m²K for glazing, ≤ 2.2 W/m²K for frames
  - Dubai: Similar requirements under Al Safat green building system
- **Thermal break profiles**: Mandatory in the Gulf — polyamide (PA66) insulating bars between inner and outer aluminium sections prevent heat transfer
- **Solar Heat Gain Coefficient (SHGC)**: Gulf codes limit SHGC to 0.25-0.40 depending on orientation — achieved through low-E coated glass and tinted interlayers

### Wind Load
- Gulf buildings must resist design wind speeds of 45-55 m/s (160-200 km/h) depending on location and height
- BS EN 12210 classifies windows by wind resistance: Gulf high-rise typically requires Class C5 (2000 Pa design pressure)
- Curtain wall wind load testing: Mock-up testing to AAMA 501 or BS EN 13830 is standard on Gulf projects >20 floors

### Water Tightness
- BS EN 12208: Water tightness classification. Gulf requirements typically Class E900 to E1500 (sprayed water at 900-1500 Pa pressure)
- Coastal projects with driving rain require the highest classifications
- Mock-up water testing is mandatory on significant Gulf projects

## Curtain Wall Systems — Gulf Standard

### Stick System
- Mullions (vertical) and transoms (horizontal) shipped to site as individual profiles, assembled in-situ
- Glass and panels installed into the assembled framework
- Suitable for low to mid-rise buildings and irregular facades
- **Quality depends on site workmanship** — every joint sealed on-site

### Unitized System
- Complete panels (typically one floor height × one module width) fabricated and glazed in factory-controlled conditions
- Shipped to site and installed by hooking onto brackets fixed to the building structure
- **Advantages**: Higher quality control, faster site installation (one panel per 15-20 minutes with experienced crew), better weather sealing
- **Gulf standard**: Unitized curtain wall is the norm for high-rise towers in Dubai, Abu Dhabi, Riyadh, and Doha

### Structural Glazing
- Glass bonded to aluminium frame with structural silicone sealant (DC 995, Sika SG-500)
- Creates a flush glass facade with no visible aluminium framing from outside
- **Silicone joint design**: Per ETAG 002 or ASTM C1401 — bite depth, contact width, and joint dimensions calculated for wind load and thermal movement
- **Gulf-specific**: UV-stable silicone is essential — inferior products fail under intense Gulf solar radiation

## Fabrication Quality

### Cutting
- Double-head mitre saw for 45° mitre cuts (windows) or 90° cuts (curtain wall mullions)
- CNC machining centers for drainage, hardware mortises, and gasket grooves — standard in Gulf fabrication workshops
- **Tolerance**: ±0.5mm on lengths, ±0.3° on mitre angles per BS EN 12020-2

### Assembly
- Corner crimping (mechanical clinching) or screw assembly depending on system
- **Corner strength**: Must exceed test requirements per BS EN 14351 Annex C — corner joints are the weakest point
- Gasket insertion: EPDM rubber gaskets must be correctly fitted with continuous corners — gaps cause water leaks
- Drainage: Every sash and frame must have clear drainage slots connected to exterior — check by pouring water

### Glazing
- Insulated Glass Units (IGU): Double or triple glazed with low-E coating and argon gas fill. Gulf specification typically 6mm + 12mm cavity + 6mm minimum
- Setting blocks, location blocks, and glazing packers positioned per system manual — incorrect blocking causes glass breakage from thermal stress
- Structural silicone application: Clean surfaces with solvent wipe, apply silicone with calibrated gun, tool joint profile, and cure per manufacturer instructions

## Safety in Gulf Aluminium Fabrication
- Glass handling is high-risk — insulated glass units are heavy (20-60kg per unit) and edges are lethal. Use suction lifters and cut-resistant gloves
- Working at height during curtain wall installation — full-body harness with twin-tail lanyard, secured to independent anchor points
- Power tool safety: CNC machines, saws, and routers require machine guarding, emergency stops, and operator training
- Silicone solvents are flammable and harmful — use in ventilated areas, no smoking, wear respiratory protection

## Key Takeaways
- Gulf aluminium fabrication demands thermal break profiles and high-performance glazing — the climate drives the specification
- Unitized curtain wall is the industry standard for Gulf high-rise — learn this system for premium employment
- Water and air tightness testing (mock-up and field) is standard — fabrication quality is directly tested and measured
- Precision is non-negotiable — CNC fabrication is the norm, and tolerances are tight
- Gulf aluminium and curtain wall skills are among the highest-paid in the construction finishing trades`,

  'safety-officer': `# Construction Safety Management — OSHAD, TRAKHEES & Gulf HSE Standards

## Introduction
Safety officers on Gulf projects operate within some of the world's most structured and enforced health, safety, and environmental (HSE) frameworks. Gulf authorities — OSHAD (Abu Dhabi Occupational Safety and Health System Framework), TRAKHEES (Dubai), MOMRA/GOSI (Saudi Arabia), and ASHGHAL (Qatar) — mandate comprehensive safety management systems. International contractors apply OHSAS 18001/ISO 45001, NEBOSH-based risk assessment, and client-specific HSE requirements that typically exceed local minimums. Safety officers must be formally qualified and continuously demonstrate competency.

## Gulf HSE Regulatory Framework

### Abu Dhabi — OSHAD SF
- OSHAD System Framework: 13 mandatory elements covering policy, risk assessment, training, inspection, incident investigation, and emergency preparedness
- **OSHAD CoP**: Codes of Practice for specific hazards — work at height, excavation, confined space, hot work, etc.
- HSE professional registration: OSHAD card required for all safety personnel — linked to NEBOSH or equivalent qualification

### Dubai — TRAKHEES / DM
- Dubai Municipality and TRAKHEES (Dubai Free Zones) regulate construction safety
- **DMCC/JAFZA/DAFZA**: Free zone specific HSE requirements in addition to DM regulations
- Green Safety Helmet program: Site safety officers identified by green helmet — authority to stop unsafe work

### Saudi Arabia — MOMRA / GOSI
- Ministry of Municipal, Rural Affairs and Housing (MOMRA) building codes include safety requirements
- General Organization for Social Insurance (GOSI) enforces workplace injury reporting and compensation
- Saudi ARAMCO and SABIC have their own HSE standards that exceed national requirements — often the benchmark for Gulf safety

## Core Safety Competencies

### Risk Assessment — The Foundation
- **HIRA (Hazard Identification and Risk Assessment)**: Systematic process per ISO 45001 / OSHAD SF Element 2
- **Task Risk Assessment (TRA)**: Conducted before every new task by the work team — safety officer reviews and approves
- **Hierarchy of Controls**: Elimination → Substitution → Engineering → Administrative → PPE — Gulf clients expect this hierarchy to be demonstrably applied
- **Residual risk**: After controls are applied, residual risk must be ALARP (As Low As Reasonably Practicable)

### Permit to Work (PTW) System
Gulf projects use a comprehensive PTW system for high-risk activities:
- **Hot Work Permit**: Any cutting, welding, grinding, or use of ignition sources
- **Confined Space Entry Permit**: Any entry into enclosed spaces with potential atmospheric hazards
- **Work at Height Permit**: Typically for work above 1.8m (OSHAD) or 2.0m (TRAKHEES) without permanent edge protection
- **Excavation Permit**: All ground-breaking activities
- **Electrical Isolation Permit**: Work on or near live electrical systems
- **PTW process**: Identify hazards → Implement controls → Authorize work → Monitor → Close out. Safety officer is central to this process

### Incident Investigation — Root Cause Analysis
Gulf projects require formal investigation of all incidents, including near-misses:
- **Immediate response**: Make safe, provide first aid, preserve the scene, notify management
- **Investigation team**: Safety officer, line supervisor, witness representatives, and (for serious incidents) client HSE representative
- **Methodology**: 5-Why analysis, Fishbone (Ishikawa) diagram, TapRooT, or ICAM (Incident Cause Analysis Method) — depending on client preference
- **Reporting timelines**: Fatalities reported to authorities within 1-4 hours. LTIs (Lost Time Injuries) within 24 hours. Near-misses within shift

## Safety Metrics on Gulf Projects
- **LTIFR (Lost Time Injury Frequency Rate)**: LTIs per million man-hours. Gulf targets typically <0.5
- **TRIFR (Total Recordable Injury Frequency Rate)**: All recordable injuries per million man-hours. Gulf targets typically <2.0
- **Leading indicators**: Safety observations, toolbox talks, inspections, training hours — Gulf clients increasingly focus on proactive measures
- **HSE dashboards**: Weekly/monthly reporting to project management and client — safety officer compiles and presents data

## Gulf-Specific Safety Challenges

### Heat Stress
- Gulf summer temperatures exceed 50°C. Mandatory heat stress management per OSHAD CoP 18 / TRAKHEES requirements
- **WBGT (Wet Bulb Globe Temperature)** monitoring: Work-rest cycles based on WBGT readings
- **Summer work ban**: Many Gulf countries restrict outdoor work during midday hours in peak summer (typically 12:30-15:00)
- **Hydration**: Minimum 250ml water every 20 minutes during hot weather. Chilled water stations at all work areas

### Working at Height
- #1 cause of construction fatalities globally and in the Gulf
- Gulf requirement: Full-body harness with twin-tail lanyard above 1.8m (OSHAD) where no permanent edge protection exists
- Rescue plan mandatory before any work at height — how will a fallen worker be recovered?
- Scaffold tag system: Green (safe), Yellow (incomplete), Red (condemned) — universal across Gulf projects

## Key Takeaways
- Gulf safety management is comprehensive and strictly enforced — non-compliance leads to fines, project shutdowns, and deportation
- NEBOSH IGC or equivalent is the minimum qualification for Gulf safety officers — NEBOSH International Diploma commands premium salaries
- Permit to Work systems are central to Gulf safety — master the PTW process and ensure rigorous compliance
- Heat stress management is a Gulf-specific critical competency — this kills workers every summer
- Leading indicators (proactive safety activities) are valued as highly as lagging indicators (injury rates) by Gulf clients`,

  cook: `# Professional Cookery — International Food Safety & Gulf Hospitality Standards

## Introduction
Professional cooks working in the Gulf hospitality industry operate in one of the world's most dynamic food service markets. Gulf countries — particularly UAE, Saudi Arabia, and Qatar — have thriving hotel, restaurant, catering, and industrial camp food service sectors. International food safety standards (HACCP, ISO 22000) are strictly enforced by Gulf municipalities, and kitchen operations follow international best practices. Pakistani cooks who combine their traditional cuisine expertise with international culinary skills and food safety certification are highly sought after in Gulf employment.

## Food Safety Standards — Gulf Requirements

### HACCP (Hazard Analysis and Critical Control Points)
Mandatory in all Gulf food service operations:
- **7 Principles**: Conduct hazard analysis, determine Critical Control Points (CCPs), establish critical limits, establish monitoring procedures, establish corrective actions, establish verification procedures, establish documentation
- **CCPs in kitchen operations**: Cooking temperature (core ≥75°C), cooling (63°C to 5°C within 90 minutes), cold storage (<5°C), hot holding (>63°C), reheating (core ≥75°C for 30 seconds)
- **Documentation**: Temperature logs, supplier records, cleaning schedules, pest control records — municipal inspectors audit these regularly

### Dubai Municipality / Abu Dhabi Food Control Authority
- All food handlers must hold a valid food handler's certificate (training through approved providers)
- Kitchen premises must meet specific design standards — separate preparation areas for raw/cooked, adequate ventilation, pest-proof construction
- Annual food establishment license renewal — dependent on passing inspection
- **Grading system**: Dubai Municipality grades food establishments (A/B/C/D) — displayed publicly. Grade affects reputation and business

### ISO 22000 (Food Safety Management System)
- International standard increasingly adopted by Gulf hotels and catering companies
- Combines HACCP principles with management system requirements
- Certifiable standard — provides competitive advantage for employers and demonstrates food safety commitment

## Kitchen Operations — International Standards

### Mise en Place (Preparation)
- **Organization**: Every ingredient measured, cut, and prepared before cooking begins — fundamental to efficient professional kitchens
- **Standardized recipes**: Gulf hotel kitchens use standardized recipes with exact quantities — ensures consistency and controls food cost
- **Portion control**: Protein portions weighed (150-250g typical), garnishes standardized — cost control is essential in Gulf F&B operations

### Cooking Methods — Gulf Menu Context
- **Grilling/BBQ**: Gulf cuisine features extensive grilling — shawarma, kebabs, grilled seafood. Charcoal and gas grills
- **Tandoor**: Pakistani and Indian cuisine is hugely popular across the Gulf — naan, tandoori chicken, kebabs
- **Sautéing**: Western and Asian fusion dishes — Gulf hotels serve international menus
- **Baking/Pastry**: Gulf hospitality demands high-quality pastry — Arabic sweets, continental desserts, bread programs
- **Sous vide**: Modern technique increasingly used in Gulf 5-star hotels — vacuum-sealed cooking at precise temperatures

### Food Cost Control
- **Food cost percentage**: Gulf hotels target 28-35% food cost (cost of ingredients ÷ selling price × 100)
- **Inventory management**: FIFO (First In, First Out) is mandatory — date-label all items, use oldest stock first
- **Waste reduction**: Track and minimize food waste — Gulf sustainability initiatives (UAE Food Waste Pledge) drive this
- **Menu engineering**: Analyze each dish by popularity and profitability — adjust menu to maximize revenue

## Kitchen Safety — International Standards
- **Burns and scalds prevention**: Dry cloths for handling hot items, call "behind" when carrying hot liquids, use splatter guards for deep frying
- **Knife safety**: Keep knives sharp (dull knives require more force and slip), use stable cutting boards, carry knives at your side pointed down, designated knife storage
- **Fire safety**: Kitchen fire suppression system (Ansul or similar) — know how to activate. Class F (cooking oil) fire extinguisher within reach of every frying station. Never use water on oil fires
- **Slip prevention**: Non-slip footwear mandatory, clean spills immediately, use floor mats in wet areas
- **Chemical safety**: Cleaning chemicals stored separately from food. COSHH (Control of Substances Hazardous to Health) assessments for all chemicals used in kitchen

## Gulf Employment — What to Expect
- **Hours**: Hospitality kitchens operate long hours — split shifts common (morning prep + evening service). Expect 10-12 hour days during busy periods
- **Hierarchy**: Kitchen brigade system — respect the chain of command. Start as Commis and progress through merit
- **Cuisine diversity**: Gulf kitchens serve Arabic, Pakistani/Indian, Western, Asian, and fusion — versatility is valued
- **Career progression**: Commis → Demi Chef → Chef de Partie → Sous Chef → Executive Chef. Gulf hotel chains (Marriott, Hilton, Accor, Rotana) offer structured career paths

## Key Takeaways
- HACCP and food safety certification are mandatory for Gulf food service — no certification means no employment
- Temperature control is the single most important food safety skill — monitor, record, and never compromise
- Pakistani cuisine expertise is a strong foundation — combine it with international techniques for maximum employability
- Food cost control is as important as cooking skills in professional kitchens — learn to manage budgets and reduce waste
- Gulf hospitality offers genuine career progression — invest in certifications (City & Guilds, HACCP Level 3, hygiene certificates) and climb the ladder`,

  'ac-technician': `# Air Conditioning & Refrigeration — ASHRAE Standards & Gulf HVAC Practice

## Introduction
AC technicians in the Gulf work on some of the world's most demanding HVAC systems. Gulf countries have the highest per-capita air conditioning demand globally — with outdoor temperatures exceeding 50°C and extreme humidity in coastal areas, reliable AC is not a luxury but a life-safety requirement. Gulf HVAC systems follow ASHRAE (American Society of Heating, Refrigerating and Air-Conditioning Engineers) standards, and technicians must understand chiller plants, VRF/VRV systems, split and package units, Building Management Systems (BMS), and refrigerant management per international environmental regulations.

## Gulf HVAC System Types

### Chiller Plants (Large Commercial/Industrial)
- **Water-cooled chillers**: Centrifugal or screw compressors, 200-2000+ TR (Tons of Refrigeration). Standard for Gulf high-rises, hospitals, and malls
- **Air-cooled chillers**: Used where cooling tower water is scarce or maintenance access is limited. Lower efficiency than water-cooled in Gulf heat
- **District cooling**: Centralized chiller plants serving entire districts through chilled water piping networks — common in Dubai (Empower, Tabreed), Abu Dhabi, and Lusail (Qatar)
- **Refrigerants**: R-134a (centrifugal), R-410A (screw), R-1234ze (new low-GWP alternative) — Gulf is transitioning under Kigali Amendment

### VRF/VRV Systems
- **Application**: Commercial offices, hotels, mixed-use buildings — Gulf projects increasingly specify VRF for flexibility
- **Principle**: Variable refrigerant flow to multiple indoor units from common outdoor condensing unit(s)
- **Heat recovery**: 3-pipe systems can simultaneously heat and cool different zones — useful for Gulf buildings where perimeter zones need cooling while interior zones may need reheat
- **Brands**: Daikin (VRV inventor), Mitsubishi Electric, LG Multi V, Samsung DVM — all have Gulf-specific models rated for 52°C+ ambient

### Package and Split Units
- **Ducted split**: Concealed indoor unit with ductwork distribution — standard for Gulf villas and apartments
- **Rooftop package units**: Self-contained units on building roofs — commercial retail, warehouses
- **Desert-rated**: Gulf-specification units have enhanced condenser coils, high-temperature compressors, and sand/dust-resistant cabinets

## ASHRAE Standards — Key References
- **ASHRAE 15**: Safety Standard for Refrigeration Systems — refrigerant quantity limits, machinery room requirements, leak detection
- **ASHRAE 34**: Refrigerant designation and safety classification (A1, A2L, B1, etc.)
- **ASHRAE 62.1**: Ventilation for Acceptable Indoor Air Quality — minimum outdoor air requirements
- **ASHRAE 90.1**: Energy Standard for Buildings — minimum efficiency requirements for HVAC equipment. Gulf building codes reference this standard
- **ASHRAE 55**: Thermal Environmental Conditions for Human Occupancy — comfort criteria (typically 22-24°C, 40-60% RH for Gulf office buildings)

## Technical Competencies for Gulf AC Technicians

### Refrigerant Management
- **Recovery**: All refrigerant must be recovered before system repair — venting is illegal under Gulf environmental regulations (aligned with Montreal Protocol / Kigali Amendment)
- **Charging**: Weigh-in method using electronic scales (most accurate), or superheat/subcooling method for field adjustment
- **Leak detection**: Electronic leak detector (minimum 5 g/year sensitivity), UV dye, or bubble solution. Gulf projects require documented leak checks per ASHRAE 15

### Controls and BMS (Building Management System)
- Modern Gulf HVAC systems are controlled through BMS (Honeywell, Siemens, Johnson Controls, Schneider Electric)
- **Technician interface**: Adjust setpoints, monitor alarms, review trend logs, override controls for maintenance
- **DDC (Direct Digital Control)**: Controllers communicate via BACnet or Modbus protocols — understanding basic controls logic is increasingly essential
- **Energy monitoring**: Gulf buildings track HVAC energy consumption — BMS data used for energy optimization

### Preventive Maintenance — Gulf Schedule
- **Monthly**: Clean/replace air filters (Gulf dust clogs filters rapidly), check refrigerant pressures, inspect electrical connections, clean drain pans and lines
- **Quarterly**: Clean condenser coils (high-pressure water wash), check belt tension on AHUs, calibrate thermostats and sensors, inspect insulation on chilled water piping
- **Annually**: Full system performance test (capacity, efficiency), electrical testing (insulation resistance, earth continuity), compressor oil analysis, chiller tube cleaning (eddy current testing for water-cooled chillers)
- **Condenser coil cleaning** is the single most impactful maintenance task in the Gulf — sand and dust accumulation can reduce capacity by 20-30%

## Safety for Gulf AC Technicians
- **Refrigerant safety**: R-410A operates at 400+ psig — high-pressure hoses and connections can fail violently. Wear safety goggles and gloves
- **Electrical**: HVAC systems operate at 220V single-phase and 380V three-phase in Gulf countries — lockout/tagout (LOTO) before any electrical work
- **Working at height**: Rooftop units and overhead ductwork require fall protection — full-body harness above 1.8m
- **Confined spaces**: Chiller plant rooms, duct interiors, and ceiling voids may be classified as confined spaces — follow permit procedures
- **Heat stress**: Working on rooftop equipment in Gulf summer is extremely hazardous — schedule outdoor work for early morning and hydrate continuously

## Key Takeaways
- Gulf HVAC systems are larger, more complex, and operate under more extreme conditions than most Pakistani residential AC — upskill accordingly
- ASHRAE standards govern Gulf HVAC design and operation — familiarize yourself with ASHRAE 15, 62.1, and 90.1
- Refrigerant management (recovery, charging, leak detection) is both a technical and environmental responsibility — Gulf regulations enforce compliance
- BMS competency is increasingly essential — technicians who can interface with building controls are more valuable
- Condenser coil cleaning and filter maintenance are the highest-impact activities — Gulf dust makes these critical for system performance`,
};


/* ─── Branching Scenario Data — trade-specific workplace decision trees ─── */
const SCENARIO_DATA = {
  mason: {
    steps: [
      {
        stepId: 'mason-1',
        narrative: 'You arrive at a construction site to begin laying block walls for a new warehouse. During your site inspection you notice the foundation has a visible crack running 2 meters along one edge and the mortar delivered is a different grade than specified in the plans.',
        choices: [
          { text: 'Report the foundation crack to the site engineer and flag the incorrect mortar grade before starting any work', nextStepId: 'mason-2a', isOptimal: true, feedback: 'Correct — never build on a compromised foundation. Reporting both issues ensures structural integrity and material compliance.', scoreImpact: 25 },
          { text: 'Start laying blocks on the undamaged section while waiting for someone else to notice the crack', nextStepId: 'mason-2b', isOptimal: false, feedback: 'Building on an uninspected foundation is dangerous. The crack may indicate deeper structural failure that could compromise the entire wall.', scoreImpact: -10 },
          { text: 'Use the delivered mortar anyway since it looks similar enough', nextStepId: 'mason-2b', isOptimal: false, feedback: 'Wrong mortar grade can cause joint failure. BS EN 998-2 specifies mortar classes for structural loads — substitution requires engineer approval.', scoreImpact: -15 },
        ],
      },
      {
        stepId: 'mason-2a',
        narrative: 'The site engineer inspects and confirms the crack is superficial but orders the correct mortar. While waiting, you are asked to set up the string line and profiles for the wall. You measure the first course and realize the building corner is 3mm out of square over a 5-meter run.',
        choices: [
          { text: 'Adjust the profiles to correct the square before laying any blocks, using the 3-4-5 triangle method to verify', nextStepId: 'mason-3a', isOptimal: true, feedback: 'Excellent — correcting square at the foundation level prevents compounding errors up the wall. The 3-4-5 method is the standard site check.', scoreImpact: 25 },
          { text: 'Proceed as-is since 3mm over 5 meters is within acceptable tolerance', nextStepId: 'mason-3b', isOptimal: false, feedback: '3mm over 5m may seem small but compounds over multiple courses and can cause door/window frame fit issues. Best practice is to correct at the base.', scoreImpact: 0 },
          { text: 'Ask another mason to double-check without attempting any correction first', nextStepId: 'mason-3b', isOptimal: false, feedback: 'While peer verification is good, you should first attempt the correction yourself. Skilled masons are expected to handle squaring independently.', scoreImpact: 5 },
        ],
      },
      {
        stepId: 'mason-2b',
        narrative: 'A supervisor notices you have started work without reporting the issues. Work is halted for a safety review. After the review, you are allowed to continue but must demonstrate proper procedure. The engineer asks you to set up profiles for the wall.',
        choices: [
          { text: 'Set up string line and profiles carefully, checking level and square at every stage', nextStepId: 'mason-3b', isOptimal: true, feedback: 'Good recovery. Demonstrating thorough setup procedure shows competence despite the earlier oversight.', scoreImpact: 15 },
          { text: 'Rush the setup to make up for lost time', nextStepId: 'mason-3b', isOptimal: false, feedback: 'Rushing after a safety stop compounds the problem. Take the time to do it right — quality cannot be recovered by speed.', scoreImpact: -10 },
        ],
      },
      {
        stepId: 'mason-3a',
        narrative: 'The correct mortar arrives. You begin laying the first course. By mid-morning the temperature has risen to 42 degrees C and the mortar is setting noticeably faster than normal. Your joints are starting to dry before you can tool them.',
        choices: [
          { text: 'Reduce batch sizes, dampen the blocks before laying, and keep mortar covered with wet hessian when not in use', nextStepId: 'mason-4', isOptimal: true, feedback: 'Perfect hot-weather masonry practice. Smaller batches prevent premature setting, dampened blocks reduce suction, and covered mortar retains workability.', scoreImpact: 25 },
          { text: 'Add extra water to the mortar mix to keep it workable longer', nextStepId: 'mason-4', isOptimal: false, feedback: 'Adding water beyond design mix weakens the mortar. Water-cement ratio is critical for strength — retempering reduces compressive strength significantly.', scoreImpact: -5 },
          { text: 'Continue at normal pace and tool the joints later even if mortar has started to set', nextStepId: 'mason-4', isOptimal: false, feedback: 'Tooling set mortar damages the joint and reduces weather resistance. Joints must be tooled while mortar is still plastic.', scoreImpact: -10 },
        ],
      },
      {
        stepId: 'mason-3b',
        narrative: 'You have the wall profiles set up. The mortar arrives and you begin the first course. A colleague asks you to leave 100mm gaps for weep holes every 900mm as per the drawing, but you notice the drawing also calls for a DPC at the base.',
        choices: [
          { text: 'Install the DPC first, then lay the first course with weep holes at the specified spacing', nextStepId: 'mason-4', isOptimal: true, feedback: 'Correct sequence — DPC must be laid before the first course to prevent rising damp. Weep holes above DPC allow cavity drainage.', scoreImpact: 20 },
          { text: 'Lay the first course first and add the DPC on top of it', nextStepId: 'mason-4', isOptimal: false, feedback: 'DPC goes on the foundation before blockwork. Placing it on top of the first course defeats its purpose of preventing ground moisture from rising into the wall.', scoreImpact: -5 },
        ],
      },
      {
        stepId: 'mason-4',
        narrative: 'By end of day the wall is at 1.2 meters. The foreman asks you to check your work before leaving. You notice one section has a slight bow (5mm over 1.2m height) and two bed joints are thicker than the 10mm specification.',
        choices: [
          { text: 'Document the deviations, mark them for correction in the morning, and inform the foreman honestly', nextStepId: null, isOptimal: true, feedback: 'Professional integrity — identifying and reporting your own defects prevents bigger problems. 5mm bow at 1.2m height needs correction before adding more courses.', scoreImpact: 25 },
          { text: 'The bow is within tolerance so report everything as acceptable', nextStepId: null, isOptimal: false, feedback: '5mm bow at 1.2m will compound with additional height and may exceed tolerance by completion. Early correction is far easier than rework at full height.', scoreImpact: 0 },
          { text: 'Leave without checking and deal with any issues tomorrow', nextStepId: null, isOptimal: false, feedback: 'Failing to self-inspect is a quality failure. End-of-day checks catch issues when they are cheapest to fix.', scoreImpact: -15 },
        ],
      },
    ],
    startStepId: 'mason-1',
    passingScore: 60,
    maxScore: 100,
  },

  electrician: {
    steps: [
      {
        stepId: 'elec-1',
        narrative: 'You are assigned to install a new sub-distribution board in a commercial building. When you open the existing main panel to identify the feed point, you find several unlabelled breakers, two cables with damaged insulation, and no as-built drawings available.',
        choices: [
          { text: 'Lock out the main supply, label all existing circuits using a circuit tracer, and report the damaged cables before proceeding', nextStepId: 'elec-2a', isOptimal: true, feedback: 'Correct — lockout/tagout is mandatory before any panel work. Identifying circuits prevents accidental disconnection of critical loads. Damaged insulation is a fire/shock hazard requiring immediate attention.', scoreImpact: 25 },
          { text: 'Work carefully around the damaged cables since they are not part of your job scope', nextStepId: 'elec-2b', isOptimal: false, feedback: 'All electricians have a duty to report hazards. Damaged insulation in a panel is a fire risk regardless of your specific task scope.', scoreImpact: -10 },
          { text: 'Turn off the main breaker and start installing the new board immediately to save time', nextStepId: 'elec-2b', isOptimal: false, feedback: 'Turning off the main without identifying circuits could disrupt fire alarms, emergency lighting, or server rooms. Circuit identification must come first.', scoreImpact: -15 },
        ],
      },
      {
        stepId: 'elec-2a',
        narrative: 'After labelling circuits and reporting the damaged cables, you plan the sub-board installation. The cable run from the main panel is 28 meters. The load calculation shows 63A maximum demand. You must choose the cable size and route.',
        choices: [
          { text: 'Select 16mm2 4-core cable rated for 63A at the installed length, route through dedicated cable tray with fire-rated penetration seals at wall crossings', nextStepId: 'elec-3a', isOptimal: true, feedback: 'Correct — cable sizing accounts for load, length (voltage drop), and installation method. Fire-rated seals maintain compartmentation per BS 7671 and building fire regulations.', scoreImpact: 25 },
          { text: 'Use 10mm2 cable since it is cheaper and the run is not that long', nextStepId: 'elec-3b', isOptimal: false, feedback: '10mm2 is undersized for 63A over 28m — voltage drop will exceed the 5% limit and the cable will overheat under full load. This violates BS 7671 Section 523.', scoreImpact: -15 },
          { text: 'Select the right cable but route it through the ceiling void without cable tray to save installation time', nextStepId: 'elec-3b', isOptimal: false, feedback: 'Loose cables in ceiling voids are a fire risk and violate installation standards. Cable tray provides mechanical protection and maintains fire compartmentation.', scoreImpact: -5 },
        ],
      },
      {
        stepId: 'elec-2b',
        narrative: 'You proceed without full circuit identification. While installing the new board, you accidentally trip a breaker supplying the building fire alarm panel. The fire alarm goes into fault mode and the building safety officer arrives.',
        choices: [
          { text: 'Apologize, restore the fire alarm supply immediately, then properly lock out and label all circuits before continuing', nextStepId: 'elec-3b', isOptimal: true, feedback: 'Restoring life-safety systems is the immediate priority. This incident demonstrates exactly why circuit identification is done first.', scoreImpact: 10 },
          { text: 'Blame the lack of circuit labels and continue with your installation', nextStepId: 'elec-3b', isOptimal: false, feedback: 'While the lack of labels contributed, a competent electrician always identifies circuits before working in a panel. Taking responsibility is professional.', scoreImpact: -10 },
        ],
      },
      {
        stepId: 'elec-3a',
        narrative: 'The cable is installed and you are connecting the sub-board. You notice the earthing arrangement is TN-S but the main earth bar has very little spare capacity. The sub-board requires its own earth connection to the main earth.',
        choices: [
          { text: 'Install a correctly sized CPC (circuit protective conductor) back to the main earth bar, verify continuity with an insulation resistance tester, and request an earth bar upgrade if capacity is insufficient', nextStepId: 'elec-4', isOptimal: true, feedback: 'Perfect — earth continuity is life-safety critical. Verifying with proper test instruments and flagging capacity issues shows professional competence.', scoreImpact: 25 },
          { text: 'Connect the earth to the nearest metal water pipe as a supplementary earth', nextStepId: 'elec-4', isOptimal: false, feedback: 'Using water pipes as primary earth connections is prohibited in modern installations. Plastic pipe sections can break the earth path, creating a lethal hazard.', scoreImpact: -15 },
        ],
      },
      {
        stepId: 'elec-3b',
        narrative: 'After resolving the earlier issues, you continue with the sub-board installation. The board is mounted and you need to connect the outgoing circuits. You have 12 single-phase circuits to install with a mix of lighting and socket outlets.',
        choices: [
          { text: 'Balance the load across all three phases, separate lighting and power circuits, install appropriate MCBs and an RCD for socket circuits per BS 7671', nextStepId: 'elec-4', isOptimal: true, feedback: 'Good practice — phase balancing prevents neutral overload, circuit separation aids fault-finding, and RCD protection on sockets is mandatory for additional protection.', scoreImpact: 20 },
          { text: 'Put all circuits on one phase to simplify the wiring', nextStepId: 'elec-4', isOptimal: false, feedback: 'Single-phase loading of a three-phase board causes neutral overload and wastes capacity. Phase balancing is a fundamental requirement.', scoreImpact: -10 },
        ],
      },
      {
        stepId: 'elec-4',
        narrative: 'Installation is complete. Before energizing the board you need to perform verification testing. The client is pressuring you to finish quickly because they need the circuits live by end of day.',
        choices: [
          { text: 'Perform all required tests — continuity, insulation resistance, polarity, earth fault loop impedance, and RCD operation — document results on the BS 7671 test certificate before energizing', nextStepId: null, isOptimal: true, feedback: 'Testing is non-negotiable regardless of client pressure. An untested installation that kills someone makes you criminally liable. Full test documentation protects everyone.', scoreImpact: 25 },
          { text: 'Do a quick visual inspection and energize to meet the deadline, then come back to test properly tomorrow', nextStepId: null, isOptimal: false, feedback: 'Energizing an untested installation violates BS 7671 and is potentially lethal. No schedule pressure justifies skipping verification testing.', scoreImpact: -15 },
          { text: 'Perform only the insulation resistance test and energize — the other tests can wait', nextStepId: null, isOptimal: false, feedback: 'Partial testing misses critical faults. Earth continuity and RCD operation tests are especially important for life safety. All tests must be completed before energizing.', scoreImpact: -5 },
        ],
      },
    ],
    startStepId: 'elec-1',
    passingScore: 60,
    maxScore: 100,
  },

  welder: {
    steps: [
      {
        stepId: 'weld-1',
        narrative: 'You are tasked with welding a structural steel beam connection in a high-rise building. The WPS (Welding Procedure Specification) calls for SMAW (stick welding) using E7018 low-hydrogen electrodes. When you open the electrode container, you notice the seal is broken and the electrodes have been exposed to humid air for an unknown period.',
        choices: [
          { text: 'Reject the exposed electrodes, request a fresh sealed container, or re-bake the electrodes at 300-350 degrees C for 1-2 hours per manufacturer instructions before use', nextStepId: 'weld-2a', isOptimal: true, feedback: 'Correct — E7018 low-hydrogen electrodes absorb moisture rapidly. Moisture causes hydrogen-induced cracking in structural welds. Re-baking or using fresh stock is mandatory per AWS D1.1.', scoreImpact: 25 },
          { text: 'Use the electrodes since they look dry and E7018 is fairly moisture-resistant', nextStepId: 'weld-2b', isOptimal: false, feedback: 'E7018 is specifically a low-hydrogen electrode — it is highly sensitive to moisture absorption. Using compromised electrodes on structural connections risks hydrogen cracking and catastrophic failure.', scoreImpact: -15 },
          { text: 'Use a torch to warm the electrodes for a few minutes before welding', nextStepId: 'weld-2b', isOptimal: false, feedback: 'Surface warming does not remove absorbed moisture from the electrode flux core. Proper re-baking in a holding oven at specified temperature and time is the only effective method.', scoreImpact: -10 },
        ],
      },
      {
        stepId: 'weld-2a',
        narrative: 'Fresh electrodes are obtained and stored in a heated quiver. You prepare the joint — a full-penetration V-groove butt weld on 20mm thick structural plate. During fit-up you measure the root gap and find it is 4mm instead of the specified 2-3mm.',
        choices: [
          { text: 'Adjust the fit-up to achieve the correct root gap, or consult the welding engineer about using a larger root face or backing to compensate if the gap cannot be reduced', nextStepId: 'weld-3a', isOptimal: true, feedback: 'Correct — root gap directly affects penetration and weld quality. Exceeding tolerance without engineer approval violates the WPS and could result in incomplete fusion or excessive distortion.', scoreImpact: 25 },
          { text: 'Proceed with the 4mm gap since 1mm extra should not matter much on 20mm plate', nextStepId: 'weld-3b', isOptimal: false, feedback: 'A 33% increase in root gap significantly affects weld volume, heat input, and distortion. On structural connections, WPS tolerances exist for good reason.', scoreImpact: -10 },
        ],
      },
      {
        stepId: 'weld-2b',
        narrative: 'You begin welding with the questionable electrodes. After completing the root pass, you notice small pinholes (porosity) on the weld surface. The QC inspector walks over for a visual check.',
        choices: [
          { text: 'Stop immediately, inform the inspector about the electrode condition, grind out the defective root pass completely, and start over with properly stored electrodes', nextStepId: 'weld-3b', isOptimal: true, feedback: 'Honest reporting and proper rework is the correct response. Surface porosity indicates worse subsurface defects. Grinding out and re-welding with good electrodes saves the joint.', scoreImpact: 15 },
          { text: 'Try to weld over the pinholes with the fill passes to seal them', nextStepId: 'weld-3b', isOptimal: false, feedback: 'Welding over porosity traps the defects subsurface. They will show up on radiographic testing and the entire weld will be rejected — doubling your rework.', scoreImpact: -15 },
        ],
      },
      {
        stepId: 'weld-3a',
        narrative: 'The joint is properly fitted. You complete the root pass and first fill pass. During inter-pass cleaning you examine the weld and notice acceptable profile, but the inter-pass temperature gauge reads 280 degrees C — the WPS specifies a maximum of 250 degrees C.',
        choices: [
          { text: 'Wait for the inter-pass temperature to drop below 250 degrees C before depositing the next pass, and adjust your welding parameters (reduce amperage or travel speed) to manage heat input', nextStepId: 'weld-4', isOptimal: true, feedback: 'Correct — exceeding inter-pass temperature affects the heat-affected zone (HAZ) microstructure, potentially reducing toughness. Patience and parameter adjustment maintain weld quality.', scoreImpact: 25 },
          { text: 'Continue welding since 30 degrees C over the limit is close enough', nextStepId: 'weld-4', isOptimal: false, feedback: 'Inter-pass temperature limits exist to control HAZ properties. Exceeding them on structural steel can cause grain growth and reduced impact toughness — especially critical in seismic or cold-service applications.', scoreImpact: -10 },
        ],
      },
      {
        stepId: 'weld-3b',
        narrative: 'After addressing the earlier issues, you continue welding. On the cap pass you are working in a windy area of the building and notice the arc is becoming unstable with visible spatter increase.',
        choices: [
          { text: 'Stop welding, erect wind shields around the joint to protect the arc and shielding gas envelope, then continue', nextStepId: 'weld-4', isOptimal: true, feedback: 'Wind disrupts the protective flux gas envelope around SMAW welds, causing porosity and nitrogen pickup. Wind shields are mandatory when conditions exceed 8 km/h at the weld zone.', scoreImpact: 20 },
          { text: 'Increase amperage to stabilize the arc in the wind', nextStepId: 'weld-4', isOptimal: false, feedback: 'Increasing amperage beyond WPS limits causes excess heat input and does not address the fundamental problem of wind disrupting the shielding gas. This may cause burn-through or HAZ damage.', scoreImpact: -10 },
        ],
      },
      {
        stepId: 'weld-4',
        narrative: 'The weld is complete. The QC inspector informs you that this joint requires radiographic (RT) testing and asks you to mark it. While cleaning up, your apprentice asks if he can practice welding on the offcut material using your qualified procedure.',
        choices: [
          { text: 'Mark the joint for RT per the drawing, then supervise the apprentice on non-structural offcuts making sure he understands the WPS is only qualified for you — he needs his own welder qualification test', nextStepId: null, isOptimal: true, feedback: 'Correct — welder qualification per AWS D1.1 / ISO 9606 is personal. Allowing an unqualified welder to use your WPS on structural work is a code violation. Supervised practice on offcuts is good mentoring.', scoreImpact: 25 },
          { text: 'Let the apprentice weld on the actual structure since it is just a small connection nearby', nextStepId: null, isOptimal: false, feedback: 'An unqualified welder performing structural work violates welding codes and creates serious liability. All structural welding must be performed by qualified welders.', scoreImpact: -20 },
          { text: 'Tell the apprentice welding is not something you can practice — you either can do it or you cannot', nextStepId: null, isOptimal: false, feedback: 'Discouraging practice is poor mentoring. Welding is a skill developed through guided practice. Offcut material is perfect for supervised training.', scoreImpact: -5 },
        ],
      },
    ],
    startStepId: 'weld-1',
    passingScore: 60,
    maxScore: 100,
  },

  plumber: {
    steps: [
      {
        stepId: 'plumb-1',
        narrative: 'You are called to a large residential building to investigate a reported drop in water pressure on the upper floors. The building is 8 stories with a rooftop gravity tank and booster pump system. The caretaker reports the issue started three days ago.',
        choices: [
          { text: 'Start with a systematic diagnosis: check the rooftop tank level, booster pump operation, pressure at multiple floors, and inspect the main riser for visible leaks or valve issues', nextStepId: 'plumb-2a', isOptimal: true, feedback: 'Correct approach — systematic diagnosis from supply to demand. Checking the tank, pump, riser pressure, and distribution identifies the failure point without guesswork.', scoreImpact: 25 },
          { text: 'Go directly to the upper floor apartments to check their individual supply valves', nextStepId: 'plumb-2b', isOptimal: false, feedback: 'Starting at individual apartments wastes time when the issue affects multiple units. The problem is likely in the common supply system — work from supply side first.', scoreImpact: -5 },
          { text: 'Assume the booster pump has failed and order a replacement immediately', nextStepId: 'plumb-2b', isOptimal: false, feedback: 'Ordering parts without diagnosis wastes money and time. The pump may be fine — the issue could be a valve, blockage, or tank level problem.', scoreImpact: -15 },
        ],
      },
      {
        stepId: 'plumb-2a',
        narrative: 'Your inspection reveals: rooftop tank is full, booster pump is running but cycling frequently (short-cycling), pressure on the 4th floor is 2.5 bar (normal) but on the 6th floor it is only 0.8 bar. You suspect an obstruction or partially closed valve in the riser between floors 4 and 6.',
        choices: [
          { text: 'Isolate the riser section between floors 4-6, check all gate valves and service valves in that section, and inspect for scale buildup or debris in the pipe', nextStepId: 'plumb-3a', isOptimal: true, feedback: 'Excellent systematic approach. Isolating the suspect section and checking valves and blockages is the correct diagnostic sequence. Scale buildup in galvanized risers is a common cause in older buildings.', scoreImpact: 25 },
          { text: 'Increase the booster pump pressure to compensate for the pressure drop', nextStepId: 'plumb-3b', isOptimal: false, feedback: 'Increasing pump pressure masks the symptom without fixing the cause. It also overpressurizes the lower floors, risking pipe and fitting failures, and wastes energy.', scoreImpact: -10 },
        ],
      },
      {
        stepId: 'plumb-2b',
        narrative: 'After checking several apartments without finding the cause, you realize the problem is in the common riser system. You now need to inspect the riser but the building has no isolation valves between floors — any work requires shutting off the entire building water supply.',
        choices: [
          { text: 'Coordinate with the building management to schedule a planned shutdown, notify all residents in advance, and prepare all tools and materials before isolating', nextStepId: 'plumb-3b', isOptimal: true, feedback: 'Planned shutdowns with resident notification are professional practice. Preparing everything before isolation minimizes downtime. This is the correct approach when isolation valves are lacking.', scoreImpact: 15 },
          { text: 'Shut off the water immediately since the problem needs urgent fixing', nextStepId: 'plumb-3b', isOptimal: false, feedback: 'Unannounced water shutdown in an occupied building causes complaints, potential damage (washing machines mid-cycle), and is unprofessional. Only emergency leaks justify immediate shutdown.', scoreImpact: -10 },
        ],
      },
      {
        stepId: 'plumb-3a',
        narrative: 'You find a gate valve on the 5th floor riser that is only 50% open — someone partially closed it. After fully opening the valve, pressure normalizes. However, while inspecting you also notice the galvanized riser pipe has significant internal scaling visible at a union joint. The building is 25 years old.',
        choices: [
          { text: 'Document the scaling issue and recommend to building management that the galvanized riser should be scheduled for replacement with copper or CPVC, including cost estimate and timeline, while noting the valve was the immediate cause', nextStepId: 'plumb-4', isOptimal: true, feedback: 'Perfect professional response — fix the immediate problem (valve), but flag the systemic issue (scaling) with a recommendation. 25-year-old galvanized pipe is at end of life in most Gulf climate conditions.', scoreImpact: 25 },
          { text: 'Fix the valve issue and leave since the scaling is not causing problems right now', nextStepId: 'plumb-4', isOptimal: false, feedback: 'Ignoring visible scaling is a missed opportunity. The scaling will worsen and eventually cause the same pressure problem. Professional plumbers flag future issues proactively.', scoreImpact: 0 },
        ],
      },
      {
        stepId: 'plumb-3b',
        narrative: 'During your inspection of the riser, you discover a slow leak at a threaded joint on the 5th floor, concealed behind a wall panel. The joint is corroded and the pipe wall is thinned. Water is dripping into the wall cavity.',
        choices: [
          { text: 'Isolate the section, cut out the corroded pipe, install a new section with appropriate fittings, and check the wall cavity for water damage that may need drying out', nextStepId: 'plumb-4', isOptimal: true, feedback: 'Correct — proper repair requires replacing the compromised section, not just patching. Checking for concealed water damage prevents mold and structural issues.', scoreImpact: 20 },
          { text: 'Apply a pipe repair clamp as a temporary fix and move on', nextStepId: 'plumb-4', isOptimal: false, feedback: 'Repair clamps on corroded, thin-walled pipe are unreliable. The pipe wall will continue to deteriorate and the clamp will eventually fail. This needs proper replacement.', scoreImpact: -5 },
        ],
      },
      {
        stepId: 'plumb-4',
        narrative: 'The repair is complete and water service is restored. Before leaving, the building caretaker asks if you can also connect a new washing machine outlet on the ground floor. You notice the proposed location has no floor drain and the waste pipe would need to connect to the kitchen waste stack.',
        choices: [
          { text: 'Explain that a washing machine needs a proper standpipe with trap and air gap, a floor drain for overflow protection, and that connecting to the kitchen waste may violate plumbing codes — recommend the correct installation approach with proper drainage', nextStepId: null, isOptimal: true, feedback: 'Excellent — code-compliant installation requires proper drainage, trap, air gap, and appropriate waste connection. Educating the client prevents future problems and shows professional knowledge.', scoreImpact: 25 },
          { text: 'Connect the washing machine drain hose directly to the kitchen waste pipe with a simple tee fitting since it is just one machine', nextStepId: null, isOptimal: false, feedback: 'Direct connection without trap and air gap allows sewer gas backflow and potential cross-contamination. This violates plumbing codes and creates health hazards.', scoreImpact: -15 },
          { text: 'Decline the work entirely since it is outside your original scope', nextStepId: null, isOptimal: false, feedback: 'While scope management is valid, a professional plumber should at least advise the client on the correct approach. Declining without guidance is a missed service opportunity.', scoreImpact: 0 },
        ],
      },
    ],
    startStepId: 'plumb-1',
    passingScore: 60,
    maxScore: 100,
  },

  'safety-officer': {
    steps: [
      {
        stepId: 'safety-1',
        narrative: 'You arrive at a construction site for your morning safety inspection. Before entering you notice several workers on the 3rd floor scaffolding without harnesses, a forklift operating near pedestrian workers with no spotter, and the site entrance has no safety signage displayed.',
        choices: [
          { text: 'Immediately address the fall hazard (workers without harnesses) as highest-risk first, halt the forklift operation until a spotter is assigned, and issue a site notice about missing signage — document all three violations', nextStepId: 'safety-2a', isOptimal: true, feedback: 'Correct prioritization — fall hazards are the leading cause of construction fatalities. Addressing life-threatening hazards first, then operational risks, then administrative issues is proper risk hierarchy.', scoreImpact: 25 },
          { text: 'Start with the missing signage at the entrance since it is the first thing you see', nextStepId: 'safety-2b', isOptimal: false, feedback: 'Signage is an administrative control — the lowest priority on the hierarchy. Workers at height without harnesses face imminent death risk and must be addressed first.', scoreImpact: -10 },
          { text: 'Take photos of all violations and file a report to be discussed at the weekly safety meeting', nextStepId: 'safety-2b', isOptimal: false, feedback: 'Workers without fall protection face imminent danger — waiting until a weekly meeting to address it could result in a fatality. Immediate intervention is required for life-safety hazards.', scoreImpact: -20 },
        ],
      },
      {
        stepId: 'safety-2a',
        narrative: 'The workers are brought down from the scaffolding and issued harnesses. The foreman pushes back, saying harnesses slow down the work and they have been working this way for months without incident. He asks you to "be reasonable" about the requirement.',
        choices: [
          { text: 'Explain that fall protection is a legal requirement, show the relevant safety regulation, document his pushback formally, and state that work at height cannot resume without proper PPE — escalate to the project manager if resistance continues', nextStepId: 'safety-3a', isOptimal: true, feedback: 'Correct — safety officers must enforce regulations regardless of pushback. Formal documentation protects you and creates a compliance record. Escalation demonstrates the chain of command is working.', scoreImpact: 25 },
          { text: 'Compromise by allowing experienced workers to work without harnesses but require them for new workers', nextStepId: 'safety-3b', isOptimal: false, feedback: 'Experience does not prevent falls — physics does not discriminate. Compromising on PPE requirements is illegal, unethical, and creates personal liability for the safety officer.', scoreImpact: -20 },
          { text: 'Agree to look the other way this time but warn that next time there will be consequences', nextStepId: 'safety-3b', isOptimal: false, feedback: 'A safety officer who negotiates on PPE requirements is failing their fundamental duty. "Next time" may come after a fatal fall. Immediate enforcement is the only acceptable response.', scoreImpact: -25 },
        ],
      },
      {
        stepId: 'safety-2b',
        narrative: 'While you were addressing the signage, a worker on the scaffolding drops a hammer that narrowly misses a ground-level worker. This near-miss highlights the urgency of the fall protection and overhead hazard issues.',
        choices: [
          { text: 'Immediately halt all scaffolding work, evacuate the area below, require harnesses and tool lanyards before work resumes, and formally investigate the near-miss per your incident reporting procedure', nextStepId: 'safety-3b', isOptimal: true, feedback: 'A near-miss is a gift — it is a warning without injury. Immediate work stoppage, proper controls implementation, and formal investigation are the correct response. This prevents the next incident from being fatal.', scoreImpact: 20 },
          { text: 'Tell the workers to be more careful and continue with your inspection', nextStepId: 'safety-3b', isOptimal: false, feedback: 'A near-miss that could have been a fatality requires more than a verbal warning. Formal investigation, root cause analysis, and control measures are mandatory.', scoreImpact: -15 },
        ],
      },
      {
        stepId: 'safety-3a',
        narrative: 'With fall protection resolved, you continue your inspection. In the basement you find workers doing hot work (grinding and welding) next to stored paint cans and solvents. There is a fire extinguisher present but it is expired (last serviced 18 months ago), and no hot work permit has been issued.',
        choices: [
          { text: 'Stop the hot work immediately, remove the flammable materials to a safe distance or move the hot work location, require a valid hot work permit with fire watch, and replace the expired extinguisher before any hot work resumes', nextStepId: 'safety-4', isOptimal: true, feedback: 'Perfect response — hot work near flammables without a permit is a top-5 construction fire cause. Every element (permit, fire watch, flammable separation, functional extinguisher) is mandatory, not optional.', scoreImpact: 25 },
          { text: 'Allow the work to continue since there is an extinguisher present, but issue the hot work permit retroactively', nextStepId: 'safety-4', isOptimal: false, feedback: 'An expired extinguisher may not function in an emergency. Retroactive permits defeat the purpose of the permit system which requires hazard assessment BEFORE work begins. This is a serious failure.', scoreImpact: -15 },
        ],
      },
      {
        stepId: 'safety-3b',
        narrative: 'Continuing your inspection, you enter a confined space entry area where workers are preparing to enter a deep manhole. They have a gas detector but have not performed an atmospheric test yet. The entry supervisor says he has done this many times and it is always fine.',
        choices: [
          { text: 'Halt the entry, require atmospheric testing for O2, LEL, H2S, and CO before anyone enters, verify the confined space entry permit is in place with rescue plan, and remind the supervisor that past experience does not guarantee safe atmosphere today', nextStepId: 'safety-4', isOptimal: true, feedback: 'Correct — confined space atmospheres can change in hours. Pre-entry atmospheric testing is non-negotiable. "It is always fine" is the exact complacency that precedes confined space fatalities.', scoreImpact: 20 },
          { text: 'Allow entry since they have a gas detector and can test while inside', nextStepId: 'safety-4', isOptimal: false, feedback: 'Testing inside a potentially IDLH atmosphere means the worker is already exposed. Pre-entry testing from outside is mandatory. Workers have died within seconds of entering oxygen-depleted spaces.', scoreImpact: -20 },
        ],
      },
      {
        stepId: 'safety-4',
        narrative: 'At end of day you must compile your daily safety report. You documented 6 violations, 1 near-miss, 2 work stoppages, and several positive observations (good housekeeping in the east wing, proper use of PPE by the MEP team). The project manager asks if you can "tone down" the report to avoid alarming the client.',
        choices: [
          { text: 'Decline to modify the report, explain that accurate safety reporting is a legal requirement and that suppressing violation data could constitute negligence, offer to present the findings constructively with corrective action plans', nextStepId: null, isOptimal: true, feedback: 'Safety reports must be accurate and complete. Suppressing data is potentially criminal if an incident later occurs. Offering constructive presentation with corrective actions is the professional compromise — facts stay, but framing focuses on improvement.', scoreImpact: 25 },
          { text: 'Remove the work stoppages from the report since they were resolved on the spot', nextStepId: null, isOptimal: false, feedback: 'Work stoppages are significant events that indicate systemic safety failures. Removing them from records prevents trend analysis and hides the true safety performance of the project.', scoreImpact: -15 },
          { text: 'Rewrite the report to show only the positive observations', nextStepId: null, isOptimal: false, feedback: 'A safety report that only shows positives is fraud. It misrepresents site conditions, prevents corrective action, and creates personal and corporate criminal liability if an incident occurs.', scoreImpact: -25 },
        ],
      },
    ],
    startStepId: 'safety-1',
    passingScore: 60,
    maxScore: 100,
  },
};



/* ─── Pre-check question generator — 5 MCQs per module for skip-testing ─── */
function generatePreCheckQuestions(title, type, trade) {
  // Generic trade-relevant pre-check questions based on module title/type
  const tradeLabel = trade.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  const templates = [
    {
      question: `What is the primary safety requirement before starting ${title.toLowerCase()}?`,
      options: ['Wear appropriate PPE', 'Skip the safety briefing', 'Work without supervision', 'Use broken tools'],
      correctOption: 0,
    },
    {
      question: `Which standard governs ${tradeLabel.toLowerCase()} work practices?`,
      options: ['No standards apply', 'Only verbal instructions', 'National and international trade standards', 'Personal preference'],
      correctOption: 2,
    },
    {
      question: `What should you do FIRST when starting "${title}"?`,
      options: ['Review the task requirements and materials', 'Start working immediately', 'Ask a colleague to do it', 'Skip to the assessment'],
      correctOption: 0,
    },
    {
      question: `Which is a key quality indicator for ${tradeLabel.toLowerCase()} work?`,
      options: ['Speed over accuracy', 'Meeting specifications and tolerances', 'Using the cheapest materials', 'Avoiding inspections'],
      correctOption: 1,
    },
    {
      question: `What is the correct procedure when encountering a problem during ${title.toLowerCase()}?`,
      options: ['Ignore it and continue', 'Stop, assess, and report to supervisor', 'Hide the issue', 'Work around it unsafely'],
      correctOption: 1,
    },
  ];
  return templates;
}

/* ─── NAVTTC-aligned quiz banks — 6 questions per trade per NQF level ─── */
const QUIZ_BANKS = {};
for (const c of navttcData.curricula) {
  QUIZ_BANKS[`${c.trade}-L${c.nqfLevel}`] = c.quizBank;
}

/* ─── 50 NAVTTC-aligned training programs (25 trades × Level 2 + Level 3) ─── */
const TRAINING_PROGRAMS = navttcData.curricula.map(c => ({
  title: c.title,
  trade: c.trade,
  nqf: c.nqfLevel,
  inst: c.institution,
  instructor: 'NAVTTC Certified Instructor',
  dur: c.duration,
  difficulty: c.difficulty,
  syllabus: c.syllabus,
  modules: c.modules,
  passMark: c.passMark || 70,
  totalHours: c.totalHours || 360,
  credits: c.credits || 36,
  navttcCode: c.navttcCode || '',
  sector: c.sector || 'Construction',
  category: c.category || 'trade-core',
  competencyTargets: c.competencyTargets || [],
  transferableSkills: c.transferableSkills || [],
  pathway: c.pathway || {},
}));

/* ─── Gulf / City & Guilds quiz banks — 6 questions per trade per NQF level ─── */
const GULF_QUIZ_BANKS = {};
for (const c of gulfData.curricula) {
  GULF_QUIZ_BANKS[`${c.trade}-L${c.nqfLevel}`] = c.quizBank;
}

/* ─── 50 Gulf/City & Guilds training programs (25 trades × Level 2 + Level 3) ─── */
const GULF_TRAINING_PROGRAMS = gulfData.curricula.map(c => ({
  title: c.title,
  trade: c.trade,
  nqf: c.nqfLevel,
  inst: c.institution,
  instructor: 'City & Guilds / NCCER Certified Instructor',
  dur: c.duration,
  difficulty: c.difficulty,
  syllabus: c.syllabus,
  modules: c.modules,
  passMark: c.passMark || 70,
  totalHours: c.totalHours || 360,
  credits: c.credits || 36,
  qualificationCode: c.qualificationCode || '',
  sector: c.sector || 'Construction',
  category: c.category || 'trade-core',
  competencyTargets: c.competencyTargets || [],
  transferableSkills: c.transferableSkills || [],
  pathway: c.pathway || {},
}));

async function seed() {
  const COURSES_ONLY = process.env.COURSES_ONLY === 'true';
  await connectDB();

  if (COURSES_ONLY) {
    console.log('COURSES_ONLY mode: clearing Training, Pathway, BadgeDefinition, LearnerProfile only...');
    await Promise.all([Training.deleteMany(), Pathway.deleteMany(), BadgeDefinition.deleteMany(), LearnerProfile.deleteMany()]);
  } else {
    console.log('Clearing existing data...');
    await Promise.all([User.deleteMany(), Worker.deleteMany(), Credential.deleteMany(), Assessment.deleteMany(), Training.deleteMany(), Pathway.deleteMany(), BadgeDefinition.deleteMany(), LearnerProfile.deleteMany()]);
  }

  // Admin user — create fresh (full seed) or find existing (courses-only)
  let admin;
  if (COURSES_ONLY) {
    admin = await User.findOne({ role: 'admin' });
    if (!admin) { console.error('No admin user found — run full seed first'); process.exit(1); }
    console.log(`Using existing admin: ${admin.email}`);
  } else {
    admin = await User.create({
      name: 'Asad Rehman', email: 'admin@ppmc.org.pk', password: 'Admin@2026',
      role: 'admin', organization: 'PPMC Peshawar', district: 'Peshawar',
    });
    // Create assessor
    await User.create({
      name: 'Dr. Khalid Mehmood', email: 'assessor@ppmc.org.pk', password: 'Assess@2026',
      role: 'assessor', organization: 'PPMC Peshawar', district: 'Peshawar',
    });
    // Create employer
    await User.create({
      name: 'Al-Futtaim Group HR', email: 'hr@alfuttaim.ae', password: 'Employer@2026',
      role: 'employer', organization: 'Al-Futtaim Group', district: 'Dubai',
    });
    // Create institution
    await User.create({
      name: 'SBBU Admin', email: 'admin@sbbu.edu.pk', password: 'Inst@2026',
      role: 'institution', organization: 'SBBU Peshawar', district: 'Peshawar',
    });
  }

  const workers = [];

  console.log(`Creating ${TRAINING_PROGRAMS.length} NAVTTC training programs...`);

  const createdPrograms = [];
  for (let pi = 0; pi < TRAINING_PROGRAMS.length; pi++) {
    const p = TRAINING_PROGRAMS[pi];
    const quizzes = QUIZ_BANKS[`${p.trade}-L${p.nqf}`] || [];
    const tradeVideos = VIDEO_URLS[p.trade] || [];
    let videoIndex = 0;

    // Build modules from NAVTTC detailed module objects (type, duration, description, competencies)
    const modules = p.modules.map((m, idx) => ({
      title: m.title,
      description: m.description || `Module ${idx + 1}: ${m.title}`,
      type: m.type,
      duration: m.duration || 45,
      order: m.order || idx + 1,
      content: m.type === 'reading' ? (READING_CONTENT[p.trade] || `# ${m.title}\n\n${m.description}`) : '',
      videoUrl: m.type === 'video' ? (tradeVideos[videoIndex++ % Math.max(tradeVideos.length, 1)] || '') : '',
      quizQuestions: m.type === 'quiz' ? quizzes : [],
      scenario: m.type === 'scenario' ? (SCENARIO_DATA[p.trade] || undefined) : undefined,
      competencies: m.competencies || [],
      preCheckQuestions: generatePreCheckQuestions(m.title, m.type, p.trade),
      deadline: new Date(2026, 1 + Math.floor(pi / 5), 15 + idx * 7),
      // ─── Competency-based assessment fields ───
      knowledgeChecks: m.knowledgeChecks || [],
      knowledgeCheckRequired: m.knowledgeCheckRequired || false,
      knowledgeCheckPassMark: m.knowledgeCheckPassMark || 70,
      rubricTemplate: m.rubricTemplate || [],
      rubricRequired: m.rubricRequired || false,
    }));

    // Sample announcements
    const announcements = [
      {
        author: admin._id,
        authorName: 'Asad Rehman',
        title: `Welcome to ${p.title}`,
        message: `Welcome to all enrolled workers! This ${p.dur} program will equip you with essential ${p.trade} skills aligned with NAVTTC NVQF Level ${p.nqf} standards. Please complete modules in order and reach out with questions. Good luck!`,
        priority: 'important',
        createdAt: new Date(2026, 0, 5),
      },
      {
        author: admin._id,
        authorName: 'Asad Rehman',
        title: 'Safety Guidelines Reminder',
        message: 'All workers must review the safety module before practical assessments. PPE is mandatory on all construction sites. Report any safety concerns immediately.',
        priority: 'normal',
        createdAt: new Date(2026, 0, 15),
      },
    ];

    const tradeLabel = p.trade.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    const program = await Training.create({
      title: p.title, trade: p.trade, nqfLevel: p.nqf,
      instructor: p.instructor, institution: p.inst,
      duration: p.dur,
      description: `${p.totalHours} contact hours, ${p.credits} credits. ${p.title} — sourced from NAVTTC NVQF Version III (navttc.gov.pk), KPTEVTA competency standards (kptevta.gov.pk), and NAVTTC NVC Level ${p.nqf} Teaching & Learning Materials for ${tradeLabel}. References PEC guidelines, Pakistan Building Code, and BS/IEC standards for Gulf readiness.`,
      modules, enrollments: [], maxEnrollment: 50, status: 'active',
      tags: [p.trade, `nqf-${p.nqf}`, p.sector.toLowerCase(), p.difficulty, 'navttc'],
      difficulty: p.difficulty,
      syllabus: p.syllabus || '',
      passMark: p.passMark,
      category: p.category,
      framework: 'navttc',
      competencyTargets: p.competencyTargets,
      gradingConfig: {
        weights: { quiz: 40, practical: 35, scenario: 15, participation: 10 },
        competencyThresholds: { foundation: 40, intermediate: 55, advanced: 70, expert: 85 },
        enforceCompetencyThresholds: true,
      },
      transferableSkills: p.transferableSkills,
      startDate: new Date(2026, 0, 1),
      endDate: new Date(2026, 5, 30),
      announcements,
    });
    createdPrograms.push(program);
  }

  // ═══════════════════════════════════════════════════════════
  // SEED GULF / CITY & GUILDS TRAINING PROGRAMS (50 programs)
  // ═══════════════════════════════════════════════════════════
  console.log(`Creating ${GULF_TRAINING_PROGRAMS.length} Gulf/City & Guilds training programs...`);

  for (let pi = 0; pi < GULF_TRAINING_PROGRAMS.length; pi++) {
    const p = GULF_TRAINING_PROGRAMS[pi];
    const quizzes = GULF_QUIZ_BANKS[`${p.trade}-L${p.nqf}`] || [];
    const tradeVideos = GULF_VIDEO_URLS[p.trade] || [];
    let videoIndex = 0;

    const modules = p.modules.map((m, idx) => ({
      title: m.title,
      description: m.description || `Module ${idx + 1}: ${m.title}`,
      type: m.type,
      duration: m.duration || 45,
      order: m.order || idx + 1,
      content: m.type === 'reading' ? (GULF_READING_CONTENT[p.trade] || `# ${m.title}\n\n${m.description}`) : '',
      videoUrl: m.type === 'video' ? (tradeVideos[videoIndex++ % Math.max(tradeVideos.length, 1)] || '') : '',
      quizQuestions: m.type === 'quiz' ? quizzes : [],
      scenario: m.type === 'scenario' ? (SCENARIO_DATA[p.trade] || undefined) : undefined,
      competencies: m.competencies || [],
      preCheckQuestions: generatePreCheckQuestions(m.title, m.type, p.trade),
      deadline: new Date(2026, 1 + Math.floor(pi / 5), 15 + idx * 7),
      // ─── Competency-based assessment fields ───
      knowledgeChecks: m.knowledgeChecks || [],
      knowledgeCheckRequired: m.knowledgeCheckRequired || false,
      knowledgeCheckPassMark: m.knowledgeCheckPassMark || 70,
      rubricTemplate: m.rubricTemplate || [],
      rubricRequired: m.rubricRequired || false,
    }));

    const tradeLabel = p.trade.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    const program = await Training.create({
      title: p.title, trade: p.trade, nqfLevel: p.nqf,
      instructor: p.instructor, institution: p.inst,
      duration: p.dur,
      description: `${p.totalHours} contact hours, ${p.credits} credits. ${p.title} — international qualification for ${tradeLabel} extracted from City & Guilds / NCCER / CISRS / CPCS frameworks. Aligned with BS 7671, BS EN 1996, ASME IX, AWS D1.1, ASHRAE, and NEBOSH IGC standards. Gulf HSE per OSHAD, ADNOC HSE, and Aramco GI. Recognized by Aramco, ADNOC, SABIC, Al-Futtaim, and major Gulf employers.`,
      modules, enrollments: [], maxEnrollment: 50, status: 'active',
      tags: [p.trade, `nqf-${p.nqf}`, p.sector.toLowerCase(), p.difficulty, 'gulf', 'city-guilds'],
      difficulty: p.difficulty,
      syllabus: p.syllabus || '',
      passMark: p.passMark,
      category: p.category,
      framework: 'gulf',
      competencyTargets: p.competencyTargets,
      transferableSkills: p.transferableSkills,
      gradingConfig: {
        weights: { quiz: 40, practical: 35, scenario: 15, participation: 10 },
        competencyThresholds: { foundation: 40, intermediate: 55, advanced: 70, expert: 85 },
        enforceCompetencyThresholds: true,
      },
      startDate: new Date(2026, 0, 15),
      endDate: new Date(2026, 6, 15),
    });
    createdPrograms.push(program);
  }

  // ═══════════════════════════════════════════════════════════
  // SEED BADGES
  // ═══════════════════════════════════════════════════════════
  console.log('Creating badge definitions...');
  await BadgeDefinition.insertMany([
    { code: 'first-course', title: 'First Steps', description: 'Complete your first course', icon: 'book', category: 'completion', xpReward: 50, criteria: { type: 'courses-completed', threshold: 1 }, rarity: 'common' },
    { code: 'five-courses', title: 'Scholar', description: 'Complete 5 courses', icon: 'graduation', category: 'completion', xpReward: 200, criteria: { type: 'courses-completed', threshold: 5 }, rarity: 'rare' },
    { code: 'ten-modules', title: 'Module Master', description: 'Complete 10 modules', icon: 'puzzle', category: 'learning', xpReward: 75, criteria: { type: 'modules-completed', threshold: 10 }, rarity: 'uncommon' },
    { code: 'fifty-modules', title: 'Knowledge Seeker', description: 'Complete 50 modules', icon: 'brain', category: 'learning', xpReward: 300, criteria: { type: 'modules-completed', threshold: 50 }, rarity: 'epic' },
    { code: 'quiz-ace', title: 'Quiz Ace', description: 'Average quiz score above 90%', icon: 'star', category: 'quiz', xpReward: 150, criteria: { type: 'quiz-score', threshold: 90 }, rarity: 'rare' },
    { code: 'quiz-master', title: 'Quiz Master', description: 'Pass 20 quizzes', icon: 'check', category: 'quiz', xpReward: 100, criteria: { type: 'quizzes-passed', threshold: 20 }, rarity: 'uncommon' },
    { code: 'streak-7', title: 'Week Warrior', description: '7-day learning streak', icon: 'fire', category: 'streak', xpReward: 100, criteria: { type: 'streak', threshold: 7 }, rarity: 'uncommon' },
    { code: 'streak-30', title: 'Unstoppable', description: '30-day learning streak', icon: 'flame', category: 'streak', xpReward: 500, criteria: { type: 'streak', threshold: 30 }, rarity: 'legendary' },
    { code: 'first-cert', title: 'Certified', description: 'Earn your first certificate', icon: 'medal', category: 'completion', xpReward: 100, criteria: { type: 'certificates', threshold: 1 }, rarity: 'common' },
    { code: 'three-certs', title: 'Triple Certified', description: 'Earn 3 certificates', icon: 'trophy', category: 'completion', xpReward: 250, criteria: { type: 'certificates', threshold: 3 }, rarity: 'rare' },
    { code: 'xp-1000', title: 'Rising Star', description: 'Earn 1,000 XP', icon: 'star', category: 'special', xpReward: 50, criteria: { type: 'xp-total', threshold: 1000 }, rarity: 'uncommon' },
    { code: 'xp-5000', title: 'Elite Learner', description: 'Earn 5,000 XP', icon: 'diamond', category: 'special', xpReward: 200, criteria: { type: 'xp-total', threshold: 5000 }, rarity: 'epic' },
  ]);

  // ═══════════════════════════════════════════════════════════
  // SEED PATHWAYS — one per trade per framework linking NQF L2 → L3
  // ═══════════════════════════════════════════════════════════
  console.log('Creating NAVTTC learning pathways (25 trades)...');

  // Group created programs by trade AND framework
  const navttcByTrade = {};
  const gulfByTrade = {};
  for (const prog of createdPrograms) {
    const bucket = prog.framework === 'gulf' ? gulfByTrade : navttcByTrade;
    if (!bucket[prog.trade]) bucket[prog.trade] = [];
    bucket[prog.trade].push(prog);
  }

  // ── NAVTTC Pathways (25) ──
  for (const [trade, programs] of Object.entries(navttcByTrade)) {
    const sorted = programs.sort((a, b) => a.nqfLevel - b.nqfLevel);
    const tradeLabel = trade.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

    const l2Data = TRAINING_PROGRAMS.find(tp => tp.trade === trade && tp.nqf === 2) || {};
    const l3Data = TRAINING_PROGRAMS.find(tp => tp.trade === trade && tp.nqf === 3) || {};

    const allCompetencies = [...(l2Data.competencyTargets || []), ...(l3Data.competencyTargets || [])];
    const uniqueCompetencies = allCompetencies.filter((c, i, arr) => arr.findIndex(x => x.skill === c.skill) === i).slice(0, 6);
    const allSkills = [...(l2Data.transferableSkills || []), ...(l3Data.transferableSkills || [])];
    const uniqueSkills = allSkills.filter((s, i, arr) => arr.findIndex(x => x.name === s.name) === i).slice(0, 4);

    const courses = sorted.map((c, idx) => ({
      training: c._id,
      order: idx + 1,
      required: true,
      estimatedWeeks: parseInt(c.duration) || 12,
    }));

    const totalWeeks = sorted.reduce((sum, p) => sum + (parseInt(p.duration) || 12), 0);
    const totalHours = TRAINING_PROGRAMS.filter(tp => tp.trade === trade).reduce((sum, tp) => sum + (tp.totalHours || 360), 0);

    const createdPathway = await Pathway.create({
      title: `${tradeLabel} — NAVTTC Progression Track`,
      description: `Complete NAVTTC pathway from NQF Level 2 (Foundation) to Level 3 (Intermediate) in ${tradeLabel}. Covers all core competencies required for trade certification and Gulf market readiness. ${totalHours} total contact hours.`,
      category: (l2Data.pathway || {}).category || 'trade-mastery',
      trade,
      framework: 'navttc',
      nqfLevelRange: { min: 2, max: 3 },
      totalDurationWeeks: totalWeeks,
      totalHours,
      dailyTargetMinutes: (l2Data.pathway || {}).dailyTargetMinutes || 60,
      competencyTargets: uniqueCompetencies,
      transferableSkills: uniqueSkills,
      credentialTitle: `${tradeLabel} Trade Certificate — NQF Level 3`,
      credentialType: 'trade-certificate',
      courses,
      status: 'active',
      maxEnrollment: 100,
      createdBy: admin._id,
    });

    for (const c of sorted) {
      await Training.findByIdAndUpdate(c._id, { pathway: createdPathway._id });
    }
  }

  // ── Gulf / City & Guilds Pathways (25) ──
  console.log('Creating Gulf/City & Guilds learning pathways (25 trades)...');

  for (const [trade, programs] of Object.entries(gulfByTrade)) {
    const sorted = programs.sort((a, b) => a.nqfLevel - b.nqfLevel);
    const tradeLabel = trade.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');

    const l2Data = GULF_TRAINING_PROGRAMS.find(tp => tp.trade === trade && tp.nqf === 2) || {};
    const l3Data = GULF_TRAINING_PROGRAMS.find(tp => tp.trade === trade && tp.nqf === 3) || {};

    const allCompetencies = [...(l2Data.competencyTargets || []), ...(l3Data.competencyTargets || [])];
    const uniqueCompetencies = allCompetencies.filter((c, i, arr) => arr.findIndex(x => x.skill === c.skill) === i).slice(0, 6);
    const allSkills = [...(l2Data.transferableSkills || []), ...(l3Data.transferableSkills || [])];
    const uniqueSkills = allSkills.filter((s, i, arr) => arr.findIndex(x => x.name === s.name) === i).slice(0, 4);

    const courses = sorted.map((c, idx) => ({
      training: c._id,
      order: idx + 1,
      required: true,
      estimatedWeeks: parseInt(c.duration) || 12,
    }));

    const totalWeeks = sorted.reduce((sum, p) => sum + (parseInt(p.duration) || 12), 0);
    const totalHours = GULF_TRAINING_PROGRAMS.filter(tp => tp.trade === trade).reduce((sum, tp) => sum + (tp.totalHours || 360), 0);

    const createdPathway = await Pathway.create({
      title: `${tradeLabel} — Gulf/City & Guilds Progression Track`,
      description: `Complete Gulf/City & Guilds pathway from Level 2 (Diploma) to Level 3 (Advanced Diploma) in ${tradeLabel}. Internationally recognized qualification for Aramco, ADNOC, SABIC, and Gulf employers. ${totalHours} total contact hours.`,
      category: 'gulf-readiness',
      trade,
      framework: 'gulf',
      nqfLevelRange: { min: 2, max: 3 },
      totalDurationWeeks: totalWeeks,
      totalHours,
      dailyTargetMinutes: (l2Data.pathway || {}).dailyTargetMinutes || 60,
      competencyTargets: uniqueCompetencies,
      transferableSkills: uniqueSkills,
      credentialTitle: `${tradeLabel} — Gulf/City & Guilds Level 3 Certificate`,
      credentialType: 'trade-certificate',
      courses,
      status: 'active',
      maxEnrollment: 100,
      createdBy: admin._id,
    });

    for (const c of sorted) {
      await Training.findByIdAndUpdate(c._id, { pathway: createdPathway._id });
    }
  }

  const stats = {
    users: await User.countDocuments(),
    workers: await Worker.countDocuments(),
    credentials: await Credential.countDocuments(),
    assessments: await Assessment.countDocuments(),
    training: await Training.countDocuments(),
    pathways: await Pathway.countDocuments(),
    badges: await BadgeDefinition.countDocuments(),
    learnerProfiles: await LearnerProfile.countDocuments(),
  };
  console.log('Seed complete:', stats);
  process.exit(0);
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
