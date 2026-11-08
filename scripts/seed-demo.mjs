/**
 * 演示站种子数据（一条命令把空库变成可演示的完整外贸站）
 *
 * 用法：
 *   node scripts/seed-demo.mjs --prepare   # 首次：建演示管理员（必须先停掉 dev server）
 *   node scripts/seed-demo.mjs             # 灌数据（dev server 要跑着）
 *   node scripts/seed-demo.mjs --reset     # 清空业务数据回到干净状态（也要先停 dev server）
 *
 * 典型「推倒重来」：--reset → npm run dev → 另开终端 npm run seed
 *
 * 设计原则：
 *   1) 全部走真实 HTTP API，不直接写 D1 —— 这样灌数据的过程本身就是一次接口回归；
 *   2) 产品图现场生成并走 /api/upload/image 上传到 R2，不依赖任何外网图床，
 *      离线也能跑，也不会让「死链检测」因为第三方 404 而误报；
 *   3) 可重复执行：每次先删掉上一轮的演示数据，不产生重复行。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { renderProductImage } from './lib/png.mjs';

const BASE = process.env.DEMO_BASE || 'http://127.0.0.1:8787';
const ADMIN_USER = 'demo';
const ADMIN_PASS = 'Demo2026!b2b';
const ROOT = path.resolve(import.meta.dirname, '..');

/* ------------------------------------------------------------------ *
 * 产品目录（12 个，覆盖 4 个分类与 4 种图样）
 * ------------------------------------------------------------------ */
const PRODUCTS = [
  {
    name: 'Stainless Steel Centrifugal Pump HR-CP100',
    slug: 'stainless-steel-centrifugal-pump-hr-cp100',
    category: 'Pumps',
    brand: 'Hengrui',
    moq: '1 set (sample) / 10 sets (bulk)',
    lead_time: '15-20 working days after deposit',
    sample_policy: 'Sample available at cost, freight collect',
    description: 'SS316L single-stage centrifugal pump for water treatment, food processing and light chemical duty.',
    detailed_description: 'The HR-CP100 is built around a precision-cast SS316L impeller and a flooded mechanical seal, which keeps the pump running for 20,000 hours between overhauls in clean-water service.\n\nA cartridge-type seal can be replaced in under 30 minutes without dismantling the pipework — a detail maintenance teams ask about first.\n\nAvailable with IE3 motors, mechanical or electrical variable speed control, and a skid-mounted base for container shipment.',
    specifications: 'Material: SS316L (wetted parts)\nFlow: 6-60 m3/h\nHead: 12-55 m\nPower: 2.2-18.5 kW\nInlet / outlet: DN50 / DN40\nSeal: cartridge mechanical seal, SiC/SiC\nMax. temperature: 120 C\nStandard: ISO 5199 / CE',
    applications: 'Water treatment, Food & beverage, Chemical dosing, HVAC circulation',
    customization: 'Flange standard (ANSI / DIN / JIS), impeller trim for duty point, IE3/IE4 motor, skid and control panel integration',
    seo_title: 'SS316L Centrifugal Pump HR-CP100 | 6-60 m3/h',
    seo_description: 'Stainless steel centrifugal pump with cartridge mechanical seal, 6-60 m3/h, IE3 motor options. ISO 5199, CE marked, 15-20 day lead time.',
    hue: 212, variant: 0, gallery: 2,
    translations: {
      es: { name: 'Bomba centrifuga de acero inoxidable HR-CP100', description: 'Bomba centrifuga de una etapa en SS316L para tratamiento de agua, alimentos y productos quimicos ligeros.' },
      ar: { name: 'مضخة طرد مركزي من الفولاذ المقاوم للصدأ HR-CP100', description: 'مضخة طرد مركزي أحادية المرحلة من SS316L لمعالجة المياه والأغذية.' },
      zh: { name: 'SS316L 不锈钢离心泵 HR-CP100', description: '单级不锈钢离心泵，适用于水处理、食品加工及轻度化工工况。' },
      'zh-TW': { name: 'SS316L 不鏽鋼離心泵 HR-CP100', description: '單級不鏽鋼離心泵，適用於水處理、食品加工及輕度化工工況。' },
    },
  },
  {
    name: 'Submersible Sewage Pump HR-SP220',
    slug: 'submersible-sewage-pump-hr-sp220',
    category: 'Pumps',
    brand: 'Hengrui',
    moq: '2 pcs',
    lead_time: '10-15 working days',
    sample_policy: 'No free sample, MOQ applies',
    description: 'Cast-iron submersible pump with vortex impeller for raw sewage and wastewater transfer.',
    detailed_description: 'A 65 mm free-passage vortex impeller handles fibrous solids without clogging — the most common failure mode of standard channel impellers in municipal lift stations.\n\nThe motor is double-sealed with an oil chamber and a moisture sensor that trips the control panel before water reaches the windings.\n\nSupplied with 10 m submersible cable, guide-rail bracket and automatic float switch.',
    specifications: 'Material: cast iron HT250, SS304 shaft\nFlow: 10-80 m3/h\nHead: 8-35 m\nPower: 1.5-15 kW\nFree passage: 65 mm\nProtection: IP68, class F insulation\nCable: 10 m submersible',
    applications: 'Municipal lift stations, Basement drainage, Construction dewatering, Food plant effluent',
    customization: 'Explosion-proof motor, higher head impeller, stainless steel body, guide rail system',
    seo_title: 'Submersible Sewage Pump HR-SP220 | 65 mm Free Passage',
    seo_description: 'IP68 submersible sewage pump with 65 mm vortex impeller, 10-80 m3/h, moisture sensor protection. Built for municipal lift stations.',
    hue: 196, variant: 3, gallery: 1,
    translations: {
      es: { name: 'Bomba sumergible para aguas residuales HR-SP220', description: 'Bomba sumergible de hierro fundido con impulsor vortex de 65 mm de paso libre.' },
      zh: { name: '潜水排污泵 HR-SP220', description: '铸铁潜水泵，配 65mm 旋流式叶轮，可处理原污水及废水输送。' },
      'zh-TW': { name: '潛水排污泵 HR-SP220', description: '鑄鐵潛水泵，配 65mm 旋流式葉輪，可處理原污水及廢水輸送。' },
    },
  },
  {
    name: 'Rotary Vane Vacuum Pump HR-RV60',
    slug: 'rotary-vane-vacuum-pump-hr-rv60',
    category: 'Pumps',
    brand: 'Hengrui',
    moq: '1 set',
    lead_time: '20-25 working days',
    sample_policy: 'Sample at cost',
    description: 'Oil-sealed rotary vane vacuum pump for packaging, drying and central vacuum systems.',
    detailed_description: 'Two-stage rotary vane design reaches 0.5 mbar ultimate pressure while keeping oil consumption under 0.3 L per 1,000 hours.\n\nThe exhaust filter captures 99.9% of oil mist, which matters when the pump sits inside a clean packaging hall rather than a plant room.\n\nGas ballast valve is standard, so water vapour from drying processes does not emulsify the oil.',
    specifications: 'Ultimate pressure: 0.5 mbar\nPumping speed: 60 m3/h\nMotor: 2.2 kW\nOil capacity: 2.0 L\nNoise: 62 dB(A)\nInlet: DN40 KF\nGas ballast: standard',
    applications: 'Vacuum packaging, Freeze drying, Pneumatic conveying, Central vacuum systems',
    customization: 'Stainless steel inlet, corrosion-resistant coating, ATEX motor, remote start contactor',
    seo_title: 'Rotary Vane Vacuum Pump HR-RV60 | 60 m3/h, 0.5 mbar',
    seo_description: 'Two-stage oil-sealed rotary vane vacuum pump, 60 m3/h, 0.5 mbar ultimate pressure, gas ballast standard. 20-25 day lead time.',
    hue: 32, variant: 0, gallery: 1,
    translations: {
      ar: { name: 'مضخة فراغ دوارة HR-RV60', description: 'مضخة فراغ دوارة ثنائية المرحلة بسرعة ضخ 60 متر مكعب في الساعة.' },
      zh: { name: '旋片式真空泵 HR-RV60', description: '油封旋片式真空泵，适用于包装、干燥及中央真空系统。' },
      'zh-TW': { name: '旋片式真空泵 HR-RV60', description: '油封旋片式真空泵，適用於包裝、乾燥及中央真空系統。' },
    },
  },
  {
    name: 'Chemical Diaphragm Dosing Pump HR-DP25',
    slug: 'chemical-diaphragm-dosing-pump-hr-dp25',
    category: 'Pumps',
    brand: 'Hengrui',
    moq: '5 pcs',
    lead_time: '12-18 working days',
    sample_policy: 'Sample at cost, freight collect',
    description: 'PTFE diaphragm metering pump with manual or 4-20 mA stroke control for water treatment dosing.',
    detailed_description: 'The dosing head is machined from solid PTFE, so it handles sodium hypochlorite, sulphuric acid and most coagulants without the seal failures common to piston pumps.\n\nStroke length is adjustable from 0 to 100% while running, and the optional 4-20 mA input lets the pump follow a residual chlorine analyser.\n\nEvery unit is pressure-tested at 1.5 times rated pressure before shipment.',
    specifications: 'Material: PTFE head, PVDF body\nFlow: 0.5-25 L/h\nPressure: up to 10 bar\nStroke rate: 0-180 spm\nControl: manual / 4-20 mA\nTurndown: 1:100\nAccuracy: +/- 1%',
    applications: 'Drinking water dosing, Cooling tower treatment, Wastewater neutralisation, Pool sanitation',
    customization: 'Digital display controller, pulse input, PVDF or stainless head, multi-pump skid',
    seo_title: 'PTFE Diaphragm Dosing Pump HR-DP25 | 0.5-25 L/h',
    seo_description: 'Chemical metering pump with solid PTFE head, 0.5-25 L/h, 10 bar, 4-20 mA control. For hypochlorite, acid and coagulant dosing.',
    hue: 148, variant: 2, gallery: 1,
    translations: {
      es: { name: 'Bomba dosificadora de diafragma HR-DP25', description: 'Bomba dosificadora con cabezal de PTFE macizo, 0.5-25 L/h, control 4-20 mA.' },
      zh: { name: '化学隔膜计量泵 HR-DP25', description: 'PTFE 隔膜计量泵，支持手动或 4-20 mA 行程控制，适用于水处理加药。' },
      'zh-TW': { name: '化學隔膜計量泵 HR-DP25', description: 'PTFE 隔膜計量泵，支援手動或 4-20 mA 行程控制，適用於水處理加藥。' },
    },
  },
  {
    name: 'Industrial Ball Valve SS316 HR-BV50',
    slug: 'industrial-ball-valve-ss316-hr-bv50',
    category: 'Valves',
    brand: 'Hengrui',
    moq: '10 pcs',
    lead_time: '10-15 working days',
    sample_policy: 'Sample at cost',
    description: 'Two-piece SS316 ball valve with full bore, ISO 5211 mounting pad and anti-static device.',
    detailed_description: 'Investment-cast SS316 body with a polished ball gives a bubble-tight shut-off to 1,000 psi in corrosive service.\n\nThe ISO 5211 pad and square stem allow direct mounting of pneumatic or electric actuators without an adaptor — one less part to misalign during installation.\n\nFire-safe design to API 607 and anti-static ball-to-stem continuity are standard, not options.',
    specifications: 'Size: DN15-DN100\nBody: SS316 investment cast\nBall: SS316, mirror polished\nSeat: PTFE / RPTFE\nPressure: 1000 PSI (PN63)\nEnd: threaded / flange\nStandard: API 608, API 607 fire safe',
    applications: 'Chemical plants, Water treatment, Petrochemical, Pulp and paper',
    customization: 'Actuator mounting, extended stem for insulation, NACE MR0175 material, locking handle',
    seo_title: 'SS316 Industrial Ball Valve HR-BV50 | Full Bore, API 607',
    seo_description: 'Two-piece stainless steel ball valve, DN15-DN100, 1000 PSI, ISO 5211 pad, fire-safe to API 607. Direct actuator mounting.',
    hue: 265, variant: 1, gallery: 2,
    translations: {
      ar: { name: 'صمام كروي صناعي SS316 HR-BV50', description: 'صمام كروي من الفولاذ المقاوم للصدأ بممر كامل وضغط 1000 PSI.' },
      zh: { name: 'SS316 工业球阀 HR-BV50', description: '两片式不锈钢球阀，全通径，ISO 5211 安装法兰及防静电设计。' },
      'zh-TW': { name: 'SS316 工業球閥 HR-BV50', description: '兩片式不鏽鋼球閥，全通徑，ISO 5211 安裝法蘭及防靜電設計。' },
    },
  },
  {
    name: 'Pneumatic Butterfly Valve HR-PBV200',
    slug: 'pneumatic-butterfly-valve-hr-pbv200',
    category: 'Valves',
    brand: 'Hengrui',
    moq: '5 pcs',
    lead_time: '15-20 working days',
    sample_policy: 'Sample at cost',
    description: 'Wafer-type pneumatic butterfly valve with double-acting or spring-return actuator and solenoid pilot.',
    detailed_description: 'A P20/17H disc profile keeps the torque curve flat across the full 90-degree travel, so a smaller actuator does the same job — useful when air supply is limited.\n\nEPDM or PTFE-lined seat options cover water, air and mild chemical duty. The spring-return version fails closed on air loss.\n\nSupplied assembled and bench-tested with solenoid valve, limit switch box and air filter regulator on request.',
    specifications: 'Size: DN50-DN600\nBody: ductile iron / SS304 / SS316\nDisc: SS304 / SS316 / nylon coated\nSeat: EPDM / PTFE\nPressure: PN10 / PN16\nActuator: double acting or spring return\nRotation: 90 degree',
    applications: 'HVAC water systems, Water treatment, Pneumatic conveying, Food processing',
    customization: 'Limit switch box, positioner, manual override, stainless body for marine duty',
    seo_title: 'Pneumatic Butterfly Valve HR-PBV200 | DN50-DN600',
    seo_description: 'Wafer butterfly valve with double-acting or spring-return pneumatic actuator, EPDM/PTFE seat, PN10/PN16. Assembled and bench tested.',
    hue: 178, variant: 1, gallery: 1,
    translations: {
      es: { name: 'Valvula de mariposa neumatica HR-PBV200', description: 'Valvula de mariposa tipo wafer con actuador neumatico de doble efecto o retorno por muelle.' },
      zh: { name: '气动蝶阀 HR-PBV200', description: '对夹式气动蝶阀，配双作用或弹簧复位执行器及电磁先导阀。' },
      'zh-TW': { name: '氣動蝶閥 HR-PBV200', description: '對夾式氣動蝶閥，配雙作用或彈簧復位執行器及電磁先導閥。' },
    },
  },
  {
    name: 'Cast Steel Gate Valve HR-GV80',
    slug: 'cast-steel-gate-valve-hr-gv80',
    category: 'Valves',
    brand: 'Hengrui',
    moq: '5 pcs',
    lead_time: '18-25 working days',
    sample_policy: 'Sample at cost',
    description: 'Bolted-bonnet cast steel gate valve, API 600, for steam and high-pressure process lines.',
    detailed_description: 'A flexible wedge absorbs thermal distortion in steam lines and keeps the seat tight through repeated cycling.\n\nBody and bonnet are both WCB cast steel with a graphite gasket rated to 425 C. Stem threads are rolled, not cut, which roughly doubles their fatigue life.\n\nBackseat design allows packing replacement with the valve in service — a maintenance requirement on most steam headers.',
    specifications: 'Size: DN50-DN300\nBody: ASTM A216 WCB\nTrim: 13% Cr stainless steel\nPressure: Class 150 / 300\nEnd: flange RF\nStandard: API 600 / ASME B16.34\nTemperature: -29 to 425 C',
    applications: 'Steam distribution, Power plants, Oil and gas, Refineries',
    customization: 'Gear operator, electric actuator, bypass arrangement, NACE trim',
    seo_title: 'API 600 Cast Steel Gate Valve HR-GV80 | Class 150/300',
    seo_description: 'Bolted bonnet gate valve, WCB body, 13% Cr trim, Class 150/300, API 600. Flexible wedge for steam and high-pressure service.',
    hue: 24, variant: 3, gallery: 1,
    translations: {
      zh: { name: '铸钢闸阀 HR-GV80', description: '螺栓阀盖铸钢闸阀，API 600 标准，适用于蒸汽及高压工艺管道。' },
      'zh-TW': { name: '鑄鋼閘閥 HR-GV80', description: '螺栓閥蓋鑄鋼閘閥，API 600 標準，適用於蒸汽及高壓工藝管道。' },
    },
  },
  {
    name: 'IE3 Three-Phase Motor 15kW HR-EM15',
    slug: 'ie3-three-phase-motor-15kw-hr-em15',
    category: 'Motors & Drives',
    brand: 'Hengrui',
    moq: '2 pcs',
    lead_time: '12-18 working days',
    sample_policy: 'No free sample',
    description: 'IE3 premium efficiency cast-iron motor, 15 kW, 4-pole, B3 foot mount, IP55.',
    detailed_description: 'Totally enclosed fan-cooled cast-iron frame with IE3 efficiency, which now meets the EU 2019/1781 minimum for motors from 0.75 kW upward.\n\nClass F insulation with a B temperature rise gives a wide thermal margin for dusty or high-altitude installations.\n\nBoth drive-end and non-drive-end bearings are regreasable on frames 160 and above, and the terminal box can be rotated in 90-degree steps.',
    specifications: 'Power: 15 kW\nPoles: 4 (1,470 rpm)\nVoltage: 380-415 V, 50 Hz\nEfficiency: IE3 (92.1%)\nFrame: 160M\nProtection: IP55\nMounting: B3 foot\nInsulation: class F',
    applications: 'Pumps, Fans, Conveyors, Compressors',
    customization: 'B5 flange, B35, dual voltage 60 Hz, PTC thermistors, tropical insulation',
    seo_title: 'IE3 15kW Three-Phase Motor HR-EM15 | IP55 Cast Iron',
    seo_description: 'IE3 premium efficiency 15 kW 4-pole cast-iron motor, IP55, class F, B3 mount. Meets EU 2019/1781 efficiency limits.',
    hue: 218, variant: 2, gallery: 1,
    translations: {
      ar: { name: 'محرك ثلاثي الطور 15 كيلوواط HR-EM15', description: 'محرك حثي بكفاءة IE3 وقدرة 15 كيلوواط وهيكل من الحديد الزهر.' },
      zh: { name: 'IE3 三相电机 15kW HR-EM15', description: 'IE3 超高能效铸铁电机，15kW，4 极，B3 底脚安装，IP55 防护等级。' },
      'zh-TW': { name: 'IE3 三相馬達 15kW HR-EM15', description: 'IE3 超高能效鑄鐵馬達，15kW，4 極，B3 底腳安裝，IP55 防護等級。' },
    },
  },
  {
    name: 'Helical Gear Reducer HR-GR120',
    slug: 'helical-gear-reducer-hr-gr120',
    category: 'Motors & Drives',
    brand: 'Hengrui',
    moq: '2 pcs',
    lead_time: '20-28 working days',
    sample_policy: 'No free sample',
    description: 'Two-stage helical gear reducer, ratios 5:1 to 200:1, IEC motor adaptor and hollow shaft options.',
    detailed_description: 'Case-hardened and ground helical gears run at under 68 dB(A) and deliver 96% efficiency per stage.\n\nThe cast-iron housing is ribbed for stiffness, and all shafts are supported by tapered roller bearings sized for overhung loads from belt drives.\n\nSynthetic oil is filled for life under normal duty, so there is no oil change on the maintenance schedule.',
    specifications: 'Output torque: up to 4,200 Nm\nRatio: 5:1 - 200:1\nStages: 2\nEfficiency: 96%\nHousing: cast iron HT250\nMounting: foot / flange / shaft mount\nLubrication: synthetic, filled for life\nStandard: ISO 6336',
    applications: 'Conveyors, Mixers, Crushers, Packaging machinery',
    customization: 'Motor adaptor for IEC 80-160, hollow shaft with shrink disc, torque arm, food-grade paint',
    seo_title: 'Helical Gear Reducer HR-GR120 | 4,200 Nm, 5:1-200:1',
    seo_description: 'Two-stage helical gear reducer up to 4,200 Nm, 96% efficiency, IEC motor adaptor, foot/flange/shaft mount options.',
    hue: 42, variant: 1, gallery: 1,
    translations: {
      zh: { name: '斜齿轮减速机 HR-GR120', description: '两级斜齿轮减速机，速比 5:1 至 200:1，配 IEC 电机接口及空心轴选项。' },
      'zh-TW': { name: '斜齒輪減速機 HR-GR120', description: '兩級斜齒輪減速機，速比 5:1 至 200:1，配 IEC 馬達接口及空心軸選項。' },
    },
  },
  {
    name: 'Hydraulic Cylinder HR-HC80',
    slug: 'hydraulic-cylinder-hr-hc80',
    category: 'Hydraulics',
    brand: 'Hengrui',
    moq: '2 pcs',
    lead_time: '15-22 working days',
    sample_policy: 'Sample at cost',
    description: 'Double-acting welded hydraulic cylinder, 80 mm bore, 25 MPa rated, hard-chrome piston rod.',
    detailed_description: 'The tube is honed to Ra 0.4 and the rod is induction-hardened then hard-chrome plated to 25 microns, which is what keeps seal life predictable in dusty environments.\n\nWelded construction removes the tie-rod stretch problems that show up on long-stroke cylinders under vibration.\n\nEvery cylinder is pressure tested at 1.5 times rated pressure for 10 minutes before painting.',
    specifications: 'Bore: 40-200 mm\nRod: 20-140 mm\nStroke: up to 3,000 mm\nPressure: 25 MPa (250 bar)\nTube: honed ST52, Ra 0.4\nRod: hard chrome 25 um\nSeals: Parker / Hallite\nTesting: 1.5x rated, 10 min',
    applications: 'Construction machinery, Agricultural equipment, Presses, Marine deck equipment',
    customization: 'Stroke length, clevis / flange / pin mounting, proximity sensors, stainless rod',
    seo_title: 'Welded Hydraulic Cylinder HR-HC80 | 25 MPa, Hard Chrome Rod',
    seo_description: 'Double-acting welded hydraulic cylinder, 40-200 mm bore, 25 MPa, honed tube and hard-chrome rod. Pressure tested at 1.5x rated.',
    hue: 8, variant: 2, gallery: 1,
    translations: {
      es: { name: 'Cilindro hidraulico HR-HC80', description: 'Cilindro hidraulico soldado de doble efecto, 25 MPa, vastago cromado.' },
      zh: { name: '液压油缸 HR-HC80', description: '双作用焊接液压油缸，缸径 80mm，额定压力 25MPa，活塞杆硬铬涂层。' },
      'zh-TW': { name: '液壓油缸 HR-HC80', description: '雙作用焊接液壓油缸，缸徑 80mm，額定壓力 25MPa，活塞桿硬鉻塗層。' },
    },
  },
  {
    name: 'Industrial Pressure Transmitter HR-IPT4',
    slug: 'industrial-pressure-transmitter-hr-ipt4',
    category: 'Instruments',
    brand: 'Hengrui',
    moq: '10 pcs',
    lead_time: '10-14 working days',
    sample_policy: 'Sample at cost',
    description: '4-20 mA pressure transmitter with SS316 diaphragm, 0.5% accuracy and HART option.',
    detailed_description: 'A piezoresistive silicon sensor isolated by a SS316L diaphragm gives stable readings in water, air and non-aggressive chemicals.\n\nThe 4-20 mA two-wire loop works with almost any PLC or indicator already on site, and the optional HART interface lets technicians re-range the device without pulling it off the line.\n\nIP65 housing with a 1/2" NPT process connection and a shielded cable gland.',
    specifications: 'Range: 0-1 to 0-100 bar\nOutput: 4-20 mA (2-wire)\nAccuracy: 0.5% FS\nSupply: 12-36 VDC\nProcess: SS316L diaphragm\nConnection: G1/2 or 1/2 NPT\nProtection: IP65\nOptional: HART / RS485',
    applications: 'Water treatment, HVAC, Compressed air, Process control',
    customization: 'HART protocol, LCD display, sanitary clamp connection, Ex ia certification',
    seo_title: 'Pressure Transmitter HR-IPT4 | 4-20 mA, 0.5% FS',
    seo_description: 'Industrial pressure transmitter with SS316L diaphragm, 4-20 mA output, 0.5% FS accuracy, IP65. HART and RS485 options.',
    hue: 190, variant: 0, gallery: 1,
    translations: {
      zh: { name: '工业压力变送器 HR-IPT4', description: '4-20 mA 压力变送器，SS316 膜片，精度 0.5%，可选 HART 协议。' },
      'zh-TW': { name: '工業壓力變送器 HR-IPT4', description: '4-20 mA 壓力變送器，SS316 膜片，精度 0.5%，可選 HART 協議。' },
    },
  },
  {
    name: 'PLC Control Cabinet HR-PLC8 IP65',
    slug: 'plc-control-cabinet-hr-plc8-ip65',
    category: 'Instruments',
    brand: 'Hengrui',
    moq: '1 set',
    lead_time: '25-35 working days',
    sample_policy: 'No free sample',
    description: 'Custom IP65 control cabinet with PLC, HMI, VFD and remote monitoring, CE marked components.',
    detailed_description: 'Built to your I/O list: we supply the schematic, terminal numbering and a wiring diagram that matches the panel as built, not as designed.\n\nComponents are CE marked and sourced through authorised channels — Siemens, Schneider or ABB depending on your preference and lead time.\n\nThe optional 4G router and MQTT gateway push run hours and alarm codes to a dashboard, which is usually what turns a service contract into a renewal.',
    specifications: 'Enclosure: 1.5-2.0 mm cold rolled steel, powder coated\nProtection: IP65\nVoltage: 380/220 V, 50/60 Hz\nPLC: Siemens S7-1200 / Schneider M221\nHMI: 7-10 inch touch panel\nVFD: 0.75-75 kW\nStandard: IEC 61439, CE',
    applications: 'Water treatment plants, Production lines, Pump stations, HVAC plants',
    customization: 'I/O count, brand preference, remote monitoring gateway, stainless enclosure, explosion-proof',
    seo_title: 'PLC Control Cabinet HR-PLC8 | IP65, IEC 61439',
    seo_description: 'Custom PLC control cabinet with HMI, VFD and optional 4G remote monitoring. IP65 enclosure, CE components, IEC 61439 built.',
    hue: 285, variant: 2, gallery: 2,
    translations: {
      ar: { name: 'لوحة تحكم PLC موديل HR-PLC8', description: 'لوحة تحكم مخصصة بدرجة حماية IP65 مع شاشة HMI ومحرك ترددي.' },
      zh: { name: 'PLC 控制柜 HR-PLC8 IP65', description: '定制 IP65 控制柜，含 PLC、HMI、变频器及远程监控，CE 认证元器件。' },
      'zh-TW': { name: 'PLC 控制櫃 HR-PLC8 IP65', description: '客製 IP65 控制櫃，含 PLC、HMI、變頻器及遠端監控，CE 認證元器件。' },
    },
  },
];

/* ------------------------------------------------------------------ *
 * 内容：案例 / 新闻 / 追加 FAQ
 * ------------------------------------------------------------------ */
const CASES = [
  {
    title: 'Twelve SS316L Pumps for a Chilean Water Utility',
    slug: 'chile-water-utility-centrifugal-pumps',
    country: 'Chile',
    industry: 'Water treatment',
    client_name: 'Municipal water utility (anonymised)',
    summary: 'Replaced mixed-brand pumps across three booster stations with a single SS316L model, cutting spare-parts inventory from 40 SKUs to 6.',
    content: '## The problem\n\nThe utility operated three booster stations with pumps from four different manufacturers. Every failure meant waiting 6-10 weeks for a part that might no longer be produced.\n\n## What we did\n\nWe surveyed the duty points at all three stations and proposed the HR-CP100 with trimmed impellers to match each station exactly. Twelve units were delivered in two shipments, each with a spare seal kit and a laminated maintenance card in Spanish.\n\n## Result\n\n- Spare-parts inventory reduced from 40 SKUs to 6\n- Average repair downtime down from 9 days to under 1 day\n- Measured energy saving of 11% after impeller trimming\n\n> "The part that mattered was not the pump, it was that all three stations now use the same one." — Maintenance manager',
    product_slugs: ['stainless-steel-centrifugal-pump-hr-cp100'],
    hue: 200, variant: 0,
  },
  {
    title: 'Pneumatic Valve Retrofit on a Polish Automotive Line',
    slug: 'poland-automotive-pneumatic-valve-retrofit',
    country: 'Poland',
    industry: 'Automotive',
    client_name: 'Tier-2 automotive parts supplier',
    summary: 'A weekend retrofit of 86 pneumatic butterfly valves with spring-return actuators reduced unplanned line stops caused by air-pressure loss.',
    content: '## The problem\n\nThe plant had double-acting actuators on critical cooling loops. When the compressor tripped, valves stayed where they were, and two loops overheated within four minutes.\n\n## What we did\n\nWe supplied 86 HR-PBV200 valves with spring-return actuators configured to fail closed, pre-assembled with solenoid pilots and limit switch boxes so the retrofit could happen in one weekend shutdown.\n\n## Result\n\n- Zero overheating events in the 14 months since the retrofit\n- Installation time per valve: 22 minutes, including wiring\n- No change to the existing PLC program',
    product_slugs: ['pneumatic-butterfly-valve-hr-pbv200'],
    hue: 170, variant: 1,
  },
  {
    title: 'Conveyor Drive Upgrade at an Australian Mine',
    slug: 'australia-mine-conveyor-drive-upgrade',
    country: 'Australia',
    industry: 'Mining',
    client_name: 'Iron ore operation (anonymised)',
    summary: 'Replaced failing shaft-mounted reducers with HR-GR120 units on a 1.8 km overland conveyor, extending service intervals from 4,000 to 12,000 hours.',
    content: '## The problem\n\nShaft-mounted reducers on the transfer conveyors were failing at around 4,000 hours. The root cause was overhung load from the belt tensioning arrangement, not the gearset itself.\n\n## What we did\n\nWe re-checked the overhung load calculation and specified the HR-GR120 with tapered roller bearings and a torque arm, which removes the load path through the housing.\n\n## Result\n\n- Service interval extended from 4,000 to 12,000 hours\n- Gearbox temperature at steady state down 14 C\n- Two-year spare-parts agreement signed after the first year',
    product_slugs: ['helical-gear-reducer-hr-gr120', 'ie3-three-phase-motor-15kw-hr-em15'],
    hue: 40, variant: 1,
  },
  {
    title: 'Containerised Dosing Skid for a UAE Desalination Plant',
    slug: 'uae-desalination-dosing-skid',
    country: 'United Arab Emirates',
    industry: 'Desalination',
    client_name: 'Desalination EPC contractor',
    summary: 'A pre-assembled dosing skid with eight PTFE diaphragm pumps and a PLC cabinet cut site commissioning from three weeks to four days.',
    content: '## The problem\n\nThe EPC contractor had 11 weeks to commission a pre-treatment dosing package, and site labour in the region was both expensive and hard to schedule.\n\n## What we did\n\nWe built the entire skid in our workshop: eight HR-DP25 pumps, calibration columns, a PLC cabinet with HMI, and all interconnecting piping in PVDF. It was hydro-tested, labelled and shipped as a single 20-foot container.\n\n## Result\n\n- Site commissioning: 4 days instead of an estimated 3 weeks\n- Zero rework on piping or wiring\n- Skid drawings delivered as-built, in both PDF and DWG',
    product_slugs: ['chemical-diaphragm-dosing-pump-hr-dp25', 'plc-control-cabinet-hr-plc8-ip65'],
    hue: 150, variant: 2,
  },
];

const POSTS = [
  {
    slug: 'canton-fair-2026-autumn-booth',
    title: 'Meet Us at Canton Fair 2026 Autumn, Booth 12.2 C08',
    category: 'event',
    excerpt: 'Phase 1, October 15-19. We are showing the new HR-CP series pumps and the IP65 control cabinet line.',
    content: 'We will be at the 138th Canton Fair, Phase 1 (October 15-19), booth **12.2 C08**.\n\n## What is on the stand\n\n- HR-CP100 centrifugal pump with cartridge seal, cutaway model\n- HR-PBV200 pneumatic valve with spring-return actuator\n- HR-PLC8 control cabinet with live remote-monitoring demo\n- Sample dosing skid for water treatment\n\n## Book a slot\n\nEmail sales@hengrui-industrial.example with your preferred time and the product you want to discuss. Bring a drawing or a sample and our application engineer will quote on the spot.\n\nWe speak English, Spanish and Arabic on the stand.',
    published_at: '2026-09-20 09:00:00',
    hue: 20, variant: 3,
  },
  {
    slug: 'new-qc-lab-in-operation',
    title: 'New In-House QC Lab Shortens Sample Lead Time to 7 Days',
    category: 'company',
    excerpt: 'Hydrostatic testing, spectrometer analysis and 72-hour continuous running tests now happen under our own roof.',
    content: 'We commissioned a 600 m2 quality control laboratory in August, with an investment of USD 450,000.\n\n## New capabilities\n\n- Hydrostatic pressure test up to 6.4 MPa\n- Spectrometer material verification on every incoming steel batch\n- 72-hour continuous duty running test\n- Vibration and noise measurement to ISO 10816\n\n## Why it matters for buyers\n\nSample lead time drops from 15 days to **7 days**, because we no longer queue for a third-party lab. Material certificates are issued with the shipment instead of a week later.\n\nEvery test record is archived for five years and can be attached to your conformity document package.',
    published_at: '2026-08-12 09:00:00',
    hue: 220, variant: 2,
  },
  {
    slug: 'how-to-choose-centrifugal-pump',
    title: 'How to Choose a Centrifugal Pump: Five Numbers Buyers Get Wrong',
    category: 'news',
    excerpt: 'Flow, head, NPSH, viscosity and duty cycle. Get these five right and the pump selection takes ten minutes.',
    content: 'Most pump enquiries we receive are missing at least two of the five numbers that decide the selection. Here is what to send.\n\n## 1. Flow rate\n\nGive the design flow in m3/h, and say whether it is a maximum or a normal value. A pump sized for the maximum runs far from its best efficiency point most of the year.\n\n## 2. Head\n\nTotal head, not just lift. Pipe friction, fittings and discharge pressure all count.\n\n## 3. NPSH available\n\nFor any application where the pump draws from a tank or a sump, NPSHa decides whether you need a self-priming or a vertical design.\n\n## 4. Viscosity and temperature\n\nAbove 100 cSt or 120 C, a standard centrifugal pump is usually the wrong choice and a rotary or diaphragm pump is not.\n\n## 5. Duty cycle\n\nContinuous or intermittent changes the motor sizing and the seal selection. A pump that runs 8 hours a day tolerates a seal that a 24/7 unit will destroy in months.',
    published_at: '2026-07-28 09:00:00',
    hue: 205, variant: 0,
  },
  {
    slug: 'eu-ie3-motor-efficiency-reminder',
    title: 'EU IE3 Rules: What Changes for Buyers Sourcing From China',
    category: 'news',
    excerpt: 'Since July 2023, IE3 is the minimum for most three-phase motors in the EU. Here is how to check a quotation.',
    content: 'The EU Regulation 2019/1781 made IE3 the minimum efficiency class for three-phase induction motors from 0.75 kW to 75 kW, with higher requirements phased in for larger frames.\n\n## What to check on a quotation\n\n- The efficiency class is stated **per motor**, not per series\n- The test report references IEC 60034-2-1\n- The nameplate shows IE3 and the efficiency value at 100% load\n\n## Where suppliers cut corners\n\nRewinding a burnt motor almost always drops it below IE3. Ask whether the motor is new or rewound, and ask for the test certificate serial number.\n\nOur HR-EM series ships with a per-unit test certificate and the efficiency value stamped on the nameplate.',
    published_at: '2026-06-15 09:00:00',
    hue: 235, variant: 2,
  },
  {
    slug: 'rooftop-solar-1-2mw',
    title: '1.2 MW Rooftop Solar Now Covers 38% of Our Electricity',
    category: 'company',
    excerpt: 'The array came online in May and is expected to cut about 900 tonnes of CO2 per year.',
    content: 'Our 1.2 MW rooftop array went into service in May, covering roughly 38% of the plant electricity demand on an annual basis.\n\n## The numbers\n\n- 2,180 panels across three workshop roofs\n- Expected generation: 1.15 GWh per year\n- CO2 reduction: about 900 tonnes per year\n\n## Why we did it\n\nTwo reasons. Electricity is a meaningful share of the cost of a machined casting, and more of our European buyers now ask for a carbon figure with the quotation. We can provide one.\n\nProduction scheduling is unchanged; the array is grid-tied with no battery storage.',
    published_at: '2026-05-30 09:00:00',
    hue: 120, variant: 1,
  },
];

const EXTRA_FAQS = [
  {
    question: 'Can you ship to a country where you have no previous customer?',
    answer: 'Yes. We ship worldwide, including destinations where we have no reference project. For first orders we usually recommend EXW or FOB so you control the freight, and we can introduce you to a forwarder we have worked with for years.',
    category: 'shipping',
    translations: {
      es: { question: 'Pueden enviar a un pais donde no tienen clientes previos?', answer: 'Si. Enviamos a todo el mundo. Para primeros pedidos recomendamos EXW o FOB.' },
      zh: { question: '可以发往你们之前没有客户的地区吗？', answer: '可以。我们全球发货，包括没有参考项目的地区。首次订单建议用 EXW 或 FOB 贸易条款，可推荐合作多年的货代。' },
      'zh-TW': { question: '可以發往你們之前沒有客戶的地區嗎？', answer: '可以。我們全球發貨，包括沒有參考項目的地區。首次訂單建議用 EXW 或 FOB 貿易條款，可推薦合作多年的貨代。' },
    },
  },
  {
    question: 'How do I get a sample before placing a bulk order?',
    answer: 'Send the model, quantity and delivery address. Samples are usually charged at cost plus freight, and the sample cost is deducted from the bulk order if it exceeds USD 5,000. Lead time for samples is 7-10 working days for standard models.',
    category: 'payment',
    translations: {
      zh: { question: '批量下单前如何获取样品？', answer: '提供型号、数量和收货地址。样品通常按成本加运费收费，批量订单超过 5000 美元可抵扣样品费。标准型号交期 7-10 个工作日。' },
      'zh-TW': { question: '批量下單前如何取得樣品？', answer: '提供型號、數量和收貨地址。樣品通常按成本加運費收費，批量訂單超過 5000 美元可抵扣樣品費。標準型號交期 7-10 個工作日。' },
    },
  },
  {
    question: 'Do you provide drawings and test certificates with the shipment?',
    answer: 'Yes — dimensional drawings, material certificates, pressure or performance test records and the operation manual are supplied as a PDF package with every shipment. Paper copies can be included on request at no charge.',
    category: 'after-sales',
    translations: {
      ar: { question: 'هل توفرون الرسومات وشهادات الاختبار مع الشحنة؟', answer: 'نعم، نوفر الرسومات الهندسية وشهادات المواد وسجلات الاختبار مع كل شحنة.' },
      zh: { question: '发货时附带图纸和检测证书吗？', answer: '是的——尺寸图纸、材质证书、压力或性能检测报告及操作手册随每批货物以 PDF 包提供。可免费加附纸质件。' },
      'zh-TW': { question: '出貨時附帶圖紙和檢測證書嗎？', answer: '是的——尺寸圖紙、材質證書、壓力或性能檢測報告及操作手冊隨每批貨物以 PDF 包提供。可免費加附紙本件。' },
    },
  },
];

/* ------------------------------------------------------------------ *
 * 询盘 / 报价 / 订单 / 订阅
 * ------------------------------------------------------------------ */
const INQUIRIES = [
  { name: 'Ahmed Al-Farsi', email: 'ahmed.alfarsi@acme-trading.example', company: 'Acme Trading LLC', country: 'United Arab Emirates', phone: '+971 50 123 4567', message: 'We need 20 units of the SS316L centrifugal pump for a water treatment project in Dubai. Please quote FOB Shanghai with 20-day delivery.', status: 'quoted', priority: 'hot', utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'pumps-uae', productIndex: 0 },
  { name: 'Marta Kowalski', email: 'm.kowalski@autoparts-pl.example', company: 'Kowalski Auto Parts', country: 'Poland', phone: '+48 601 234 567', message: 'Looking for pneumatic butterfly valves DN100, 40 pcs. Do you have spring return actuators in stock?', status: 'processing', priority: 'hot', utm_source: 'linkedin', utm_medium: 'social', productIndex: 5 },
  { name: 'James Whitfield', email: 'j.whitfield@mineops-au.example', company: 'MineOps Australia', country: 'Australia', phone: '+61 4 1234 5678', message: 'We need gear reducers for a conveyor upgrade. Ratio around 40:1, output torque 3000 Nm. What is your lead time?', status: 'won', priority: 'hot', utm_source: 'organic', productIndex: 8 },
  { name: 'Sofia Hernandez', email: 'sofia@aguapura-cl.example', company: 'Agua Pura SpA', country: 'Chile', phone: '+56 9 8765 4321', message: 'Please send catalogue and price list for centrifugal pumps 15 kW. We are a water utility.', status: 'completed', priority: 'warm', utm_source: 'google', utm_medium: 'organic', productIndex: 0 },
  { name: 'Thomas Berger', email: 't.berger@berger-industrie.example', company: 'Berger Industrie GmbH', country: 'Germany', phone: '+49 171 2345678', message: 'Do you have CE certificates for the dosing pumps? Our customer requires full documentation.', status: 'pending', priority: 'warm', utm_source: null, productIndex: 3 },
  { name: 'Rashid Khan', email: 'rashid@khantrading-ae.example', company: 'Khan Trading FZE', country: 'United Arab Emirates', phone: '+971 55 987 6543', message: 'Interested in the PLC control cabinet. Can you customize for 24 digital inputs and 16 relay outputs?', status: 'pending', priority: 'warm', utm_source: 'alibaba', utm_medium: 'referral', productIndex: 11 },
  { name: 'Lucas Silva', email: 'lucas@silva-equip-br.example', company: 'Silva Equipamentos', country: 'Brazil', phone: '+55 11 98765 4321', message: 'Bom dia. Preciso de 10 bombas submersiveis. Qual o prazo de entrega para Santos?', status: 'lost', priority: 'cold', utm_source: 'google', utm_medium: 'cpc', productIndex: 1 },
  { name: 'Nina Petrova', email: 'n.petrova@petrova-import.example', company: 'Petrova Import', country: 'Russia', phone: '+7 916 123 4567', message: 'Need pressure transmitters, 50 pcs, 0-16 bar, 4-20mA. Please quote CIF Novorossiysk.', status: 'pending', priority: 'cold', utm_source: null, productIndex: 10 },
];

const SUBSCRIBERS = [
  { email: 'ahmed.alfarsi@acme-trading.example', status: 'confirmed', lang: 'en', source: 'footer' },
  { email: 'm.kowalski@autoparts-pl.example', status: 'confirmed', lang: 'en', source: 'news' },
  { email: 'sofia@aguapura-cl.example', status: 'confirmed', lang: 'es', source: 'footer' },
  { email: 'procurement@nordicwater-no.example', status: 'pending', lang: 'en', source: 'footer' },
  { email: 'buyer@sunrise-machinery-in.example', status: 'pending', lang: 'en', source: 'news' },
  { email: 'old.contact@legacy-buyer.example', status: 'unsubscribed', lang: 'en', source: 'footer' },
];

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */
const results = { created: {}, skipped: [], errors: [] };

function log(msg) { console.log(msg); }

async function api(pathname, { method = 'GET', body, token, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + '/api' + pathname, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, ok: res.ok, json };
}

function bun(p, err) {
  results.errors.push(`${p}: ${err}`);
  console.log(`  ✗ ${p} — ${err}`);
}

/** 建演示管理员：必须停 server 才能安全写 D1 */
async function prepare() {
  log('\n[prepare] 创建演示管理员（需要 dev server 已停止）');

  const enc = new TextEncoder();
  const ITER = 150000;
  const b64url = (input) => {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return Buffer.from(s, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(ADMIN_PASS), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, key, 256);
  const hash = `pbkdf2$${ITER}$${b64url(salt)}$${b64url(bits)}`;

  const sql = [
    "DELETE FROM admins WHERE username = 'demo';",
    `INSERT INTO admins (username, password_hash, email, role) VALUES ('${ADMIN_USER}', '${hash}', 'demo@hengrui-industrial.example', 'super_admin');`,
  ].join(' ');

  const wrangler = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'b2b_database', '--local', `--command=${sql}`], {
    cwd: ROOT, stdio: 'pipe',
  });
  log(`  ✓ 管理员 ${ADMIN_USER} / ${ADMIN_PASS}`);
}

/**
 * 把业务数据清空，回到「刚建表」的状态（保留 admins 与 login_logs）。
 * 用途：跑完几轮 UI 测试后，站上会堆一批 crm-xxx@example.com 的询盘、
 * 转不了也删不掉的已发货订单、ui-test-news 之类的文章，手工点起来很乱。
 * 必须先停 dev server —— 两个进程同时写本地 SQLite 会锁库。
 */
async function reset() {
  log('\n[reset] 清空业务数据（保留管理员账号）');
  const tables = [
    'quote_items', 'quote_items', 'order_items', 'order_events',
    'quotes', 'orders', 'activities', 'inquiries', 'customers',
    'magic_tokens', 'customer_accounts', 'subscribers',
    'products', 'posts', 'cases', 'certifications', 'brands', 'faqs', 'factory_assets',
  ];
  // 顺序：先子表后主表；重复项无害，SQLite 删空表是幂等的
  const sql = tables.map(t => `DELETE FROM ${t};`).join(' ');
  const wrangler = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const run = (args) => execFileSync(process.execPath, [wrangler, 'd1', 'execute', 'b2b_database', '--local', ...args], {
    cwd: ROOT, stdio: 'pipe', encoding: 'utf8',
  });

  const r = run([`--command=${sql}`]);
  if (!/success"\s*:\s*true/.test(r)) {
    log('  ⚠️ 删除返回里没看到 success，请人工确认：' + r.slice(-300));
  }
  // 光删表不够：bootstrap.sql 里有 5 条基础 FAQ、示例产品等 INSERT OR IGNORE 种子行，
  // 删掉就再也回不来（FAQ 页会只剩后来追加的 3 条）。bootstrap 本身幂等，重跑一遍即可。
  run(['--file=schema/bootstrap.sql']);
  log('  ✓ 业务表已清空并重放 bootstrap 基础数据（admins / login_logs 保留）');
  log('  下一步：npm run dev  然后另开终端 npm run seed');
}

async function login() {
  const res = await api('/admin/login', { method: 'POST', body: { username: ADMIN_USER, password: ADMIN_PASS } });
  if (!res.ok || !res.json?.success) {
    throw new Error(`登录失败 (${res.status}): ${JSON.stringify(res.json).slice(0, 200)}\n先跑 node scripts/seed-demo.mjs --prepare（要先停 dev server）`);
  }
  return res.json.data.token;
}

async function uploadImage(token, buf, name) {
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'image/png' }), `${name}.png`);
  const res = await fetch(BASE + '/api/upload/image', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(`upload ${name}: ${res.status} ${JSON.stringify(json).slice(0, 160)}`);
  return json.data.url;
}

/**
 * 图片带缓存的上传：同一张演示图只进 R2 一次。
 * 否则每跑一次 seed 就往桶里多塞 39 张孤儿对象，R2 账单看不出问题但存储会一直涨。
 */
const IMG_CACHE_FILE = path.join(ROOT, '.demo-images.json');
let imgCache = {};
try { imgCache = JSON.parse(fs.readFileSync(IMG_CACHE_FILE, 'utf8')) || {}; } catch { imgCache = {}; }
let uploadCount = 0;

async function image(token, key, buf, name) {
  const hit = imgCache[key];
  if (hit) {
    const probe = await fetch(BASE + hit, { method: 'GET' }).catch(() => null);
    if (probe && probe.ok) return hit;
  }
  const url = await uploadImage(token, buf, name);
  imgCache[key] = url;
  uploadCount++;
  return url;
}

/**
 * 清掉不该存在的占位数据。
 * 注意：产品与内容接口的 DELETE 都是**软删除**（is_active=0 / is_published=0），
 * slug 的 UNIQUE 索引仍然占着 —— 所以演示数据不能靠「删了重建」，必须走 upsert。
 */
async function cleanPrevious(token) {
  log('\n[1/6] 清理占位数据');
  const prod = await api('/products?limit=200', { token });
  let removed = 0;
  for (const p of (prod.json?.data || [])) {
    // 清三类残留：
    //   sample-*            bootstrap 自带占位产品
    //   Audit Test Product  ui-audit 的临时产品（它自己也会清，这里是兜底）
    //   csv-* / ui-test-*   phase1c 的 CSV / 产品弹窗测试建的产品，跑完不删
    //                       —— 不清的话，每跑一次 npm run test:all 演示站就多两三个假产品
    const slug = String(p.slug || '');
    const junk = slug.startsWith('sample-')
      || /^Audit Test Product/.test(p.name || '')
      || /^(csv-|ui-test-)/.test(slug);
    if (!junk) continue;
    // 先软删（置 is_active=0），再 purge 物理删除；否则每跑一次都会在后台列表里留一行 Inactive
    const r = await api(`/products/${p.id}`, { method: 'DELETE', token });
    if (!r.ok) continue;
    const pr = await api(`/products/${p.id}?purge=1`, { method: 'DELETE', token });
    if (pr.ok) removed++;
  }
  // bootstrap 自带的示例新闻（和演示站的展会/实验室主题重复）
  const posts = await api('/content/posts', { token });
  for (const row of (posts.json?.data || [])) {
    if (['canton-fair-2026-autumn', 'new-qc-lab-2026'].includes(row.slug)) {
      await api(`/content/posts/${row.id}`, { method: 'DELETE', token });
      removed++;
    }
  }
  log(`  隐藏 ${removed} 条占位数据`);
}

async function main() {
  const t0 = Date.now();
  const token = await login();
  log(`[ok] 已登录，token ${token.slice(0, 18)}...`);

  await cleanPrevious(token);

  /* ---- 图片 ---- */
  log('\n[2/6] 生成并上传图片（已传过的复用，不重复占 R2）');
  const imgUrl = {};
  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i];
    const key = `p${i + 1}`;
    const main = renderProductImage(1000, 750, p.hue, p.variant);
    imgUrl[p.slug] = [await image(token, key, main, key)];
    for (let g = 0; g < (p.gallery || 0); g++) {
      const gk = `p${i + 1}-g${g + 1}`;
      const buf = renderProductImage(1000, 750, (p.hue + 24 * (g + 1)) % 360, (p.variant + g + 1) % 4);
      imgUrl[p.slug].push(await image(token, gk, buf, gk));
    }
  }
  log(`  ✓ 产品图 ${Object.values(imgUrl).flat().length} 张`);

  const caseImg = [];
  for (let i = 0; i < CASES.length; i++) {
    caseImg.push(await image(token, `case${i + 1}`, renderProductImage(1000, 600, CASES[i].hue, CASES[i].variant), `case${i + 1}`));
  }
  const postImg = [];
  for (let i = 0; i < POSTS.length; i++) {
    postImg.push(await image(token, `post${i + 1}`, renderProductImage(1000, 600, POSTS[i].hue, POSTS[i].variant), `post${i + 1}`));
  }
  log(`  ✓ 内容封面 ${caseImg.length + postImg.length} 张`);

  // 证书图：bootstrap 里指向 /images/placeholder.svg，不 404 但全站一样，换成生成图
  const certRes = await api('/content/certifications', { token });
  const certs = certRes.json?.data || [];
  for (let i = 0; i < certs.length; i++) {
    const ck = `cert${i + 1}`;
    const url = await image(token, ck, renderProductImage(640, 860, 206 + i * 26, 1), ck);
    await api(`/content/certifications/${certs[i].id}`, { method: 'PUT', token, body: { image_url: url } });
  }
  log(`  ✓ 证书图 ${certs.length} 张 · 本轮新上传 ${uploadCount} 张`);

  /* ---- 产品 ---- */
  log('\n[3/6] 创建 / 更新产品（按 slug upsert）');
  const productIdBySlug = {};
  const existingProducts = new Map();
  for (const p of ((await api('/products?limit=200', { token })).json?.data || [])) {
    if (p.slug) existingProducts.set(p.slug, p.id);
  }
  let prodCreated = 0, prodUpdated = 0;
  for (const p of PRODUCTS) {
    const body = {
      name: p.name,
      slug: p.slug,
      category: p.category,
      brand: p.brand,
      moq: p.moq,
      lead_time: p.lead_time,
      sample_policy: p.sample_policy,
      description: p.description,
      detailed_description: p.detailed_description,
      specifications: p.specifications,
      image_url: imgUrl[p.slug][0],
      // 直接传对象：API 会负责序列化。这里再 JSON.stringify 一次，
      // 库里就会存成双层编码（"{\"es\":...}"），前台译文静默失效。
      gallery_images: imgUrl[p.slug].slice(1),
      applications: p.applications,
      customization: p.customization,
      seo_title: p.seo_title,
      seo_description: p.seo_description,
      translations: p.translations || {},
      is_featured: p.variant === 0 ? 1 : 0,
      is_active: 1,
    };
    const existingId = existingProducts.get(p.slug);
    if (existingId) {
      const res = await api(`/products/${existingId}`, { method: 'PUT', body, token });
      if (res.ok) { productIdBySlug[p.slug] = existingId; prodUpdated++; }
      else bun(`product update ${p.slug}`, `${res.status} ${JSON.stringify(res.json).slice(0, 160)}`);
    } else {
      const res = await api('/products', { method: 'POST', body, token });
      if (res.ok && res.json?.success) { productIdBySlug[p.slug] = res.json.data.id; prodCreated++; }
      else bun(`product ${p.slug}`, `${res.status} ${JSON.stringify(res.json).slice(0, 160)}`);
    }
  }
  // 关联产品：同分类的其他产品（详情页「相关产品」区块不再落空）
  for (const p of PRODUCTS) {
    const id = productIdBySlug[p.slug];
    if (!id) continue;
    const siblings = PRODUCTS.filter(x => x.category === p.category && x.slug !== p.slug)
      .map(x => productIdBySlug[x.slug]).filter(Boolean).slice(0, 3);
    if (siblings.length) {
      await api(`/products/${id}`, { method: 'PUT', body: { related_ids: siblings }, token });
    }
  }
  log(`  ✓ 产品 ${Object.keys(productIdBySlug).length}/${PRODUCTS.length}`);

  /* ---- 案例 / 新闻 / FAQ ---- */
  log('\n[4/6] 创建案例、新闻与 FAQ（按 slug upsert）');
  const existingCases = new Map();
  for (const c of ((await api('/content/cases', { token })).json?.data || [])) existingCases.set(c.slug, c.id);
  const existingPosts = new Map();
  for (const p of ((await api('/content/posts', { token })).json?.data || [])) existingPosts.set(p.slug, p.id);

  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    const ids = (c.product_slugs || []).map(s => productIdBySlug[s]).filter(Boolean);
    const body = {
      title: c.title, slug: c.slug, country: c.country, industry: c.industry,
      client_name: c.client_name, summary: c.summary, content: c.content,
      cover_image: caseImg[i],
      product_ids: ids,
      is_published: 1,
    };
    const hit = existingCases.get(c.slug);
    const res = hit
      ? await api(`/content/cases/${hit}`, { method: 'PUT', body, token })
      : await api('/content/cases', { method: 'POST', body, token });
    if (!res.ok) bun(`case ${c.slug}`, `${res.status} ${JSON.stringify(res.json).slice(0, 160)}`);
  }
  for (let i = 0; i < POSTS.length; i++) {
    const p = POSTS[i];
    const body = {
      title: p.title, slug: p.slug, category: p.category, excerpt: p.excerpt,
      content: p.content, cover_image: postImg[i], published_at: p.published_at, is_published: 1,
    };
    const hit = existingPosts.get(p.slug);
    const res = hit
      ? await api(`/content/posts/${hit}`, { method: 'PUT', body, token })
      : await api('/content/posts', { method: 'POST', body, token });
    if (!res.ok) bun(`post ${p.slug}`, `${res.status} ${JSON.stringify(res.json).slice(0, 160)}`);
  }
  const faqRes = await api('/content/faqs', { token });
  const faqQuestions = new Set((faqRes.json?.data || []).map(f => f.question));
  for (const f of EXTRA_FAQS) {
    if (faqQuestions.has(f.question)) continue;
    const res = await api('/content/faqs', {
      method: 'POST', token,
      body: { question: f.question, answer: f.answer, category: f.category, translations: f.translations || {}, sort_order: 9 },
    });
    if (!res.ok) bun(`faq ${f.question.slice(0, 30)}`, `${res.status} ${JSON.stringify(res.json).slice(0, 160)}`);
  }

  /* ---- 询盘 ---- */
  log('\n[5/6] 创建询盘');
  const existingInquiryEmails = new Set(
    ((await api('/inquiries?limit=200', { token })).json?.data || []).map(i => i.email)
  );
  let inquiryCount = 0;
  for (const inq of INQUIRIES) {
    if (existingInquiryEmails.has(inq.email)) { inquiryCount++; continue; }
    const p = PRODUCTS[inq.productIndex];
    const res = await api('/inquiries', {
      method: 'POST',
      body: {
        name: inq.name, email: inq.email, company: inq.company, country: inq.country,
        phone: inq.phone, message: inq.message,
        product_id: productIdBySlug[p.slug] || null,
        consent: 1,
        utm_source: inq.utm_source || undefined,
        utm_medium: inq.utm_medium || undefined,
        utm_campaign: inq.utm_campaign || undefined,
        landing_page: `/products/${p.slug}`,
      },
    });
    if (res.ok) inquiryCount++;
    else bun(`inquiry ${inq.email}`, `${res.status} ${JSON.stringify(res.json).slice(0, 160)}`);

    // 状态需要后台改（公开接口只允许 pending）
    if (res.ok && inq.status !== 'pending' && res.json?.data?.id) {
      await api(`/inquiries/${res.json.data.id}`, { method: 'PUT', body: { status: inq.status, priority: inq.priority }, token });
    }
  }
  log(`  ✓ 询盘 ${inquiryCount}/${INQUIRIES.length}`);

  /* ---- 报价单 + 订单 ---- */
  log('\n[6/6] 创建报价单与订单');
  const quoteSpecs = [
    { email: 'ahmed.alfarsi@acme-trading.example', name: 'Ahmed Al-Farsi', company: 'Acme Trading LLC', country: 'AE', items: [[0, 20, 1250]], send: true, accept: true },
    { email: 'm.kowalski@autoparts-pl.example', name: 'Marta Kowalski', company: 'Kowalski Auto Parts', country: 'PL', items: [[5, 40, 186], [4, 40, 96]], send: true, accept: false },
    { email: 'sofia@aguapura-cl.example', name: 'Sofia Hernandez', company: 'Agua Pura SpA', country: 'CL', items: [[0, 12, 1340]], send: false, accept: false },
  ];
  const quoteIds = [];
  const existingQuoteEmails = new Set(
    ((await api('/quotes?limit=200', { token })).json?.data || []).map(q => q.customer_email)
  );
  for (const q of quoteSpecs) {
    if (existingQuoteEmails.has(q.email)) continue;
    const items = q.items.map(([idx, qty, price]) => ({
      product_id: productIdBySlug[PRODUCTS[idx].slug],
      name: PRODUCTS[idx].name,
      spec: PRODUCTS[idx].specifications.split('\n').slice(0, 2).join(' / '),
      qty, unit: 'pcs', unit_price: price,
    }));
    const res = await api('/quotes', {
      method: 'POST', token,
      body: {
        customer_email: q.email, customer_name: q.name, customer_company: q.company,
        customer_country: q.country, currency: 'USD', incoterm: 'FOB',
        payment_terms: '30% T/T deposit, balance before shipment',
        valid_until: '2026-12-31', discount_type: 'percent', discount_value: 3,
        shipping_amount: 480, items,
      },
    });
    if (!res.ok) { bun(`quote ${q.email}`, `${res.status} ${JSON.stringify(res.json).slice(0, 160)}`); continue; }
    const id = res.json.data.id;
    quoteIds.push({ id, email: q.email, items });
    if (q.send) {
      const s = await api(`/quotes/${id}/send`, { method: 'POST', token });
      if (!s.ok) bun(`quote send ${id}`, `${s.status}`);
      if (q.accept) {
        // 用客户视角接受，验证 /api/quotes/respond 全链路
        await api('/quotes/respond', { method: 'POST', body: { token: s.json?.data?.token, action: 'accept', message: 'Confirmed, please proceed.' } });
      }
    }
  }
  log(`  ✓ 报价单 ${quoteIds.length}/${quoteSpecs.length}`);

  // 从已接受的报价转订单
  const accepted = quoteIds[0];
  if (accepted) {
    const id2 = quoteIds[1]?.id;
    const o = await api('/orders', {
      method: 'POST', token,
      body: id2
        ? { customer_email: quoteIds[1].email, customer_name: 'Marta Kowalski', customer_company: 'Kowalski Auto Parts', customer_country: 'PL', currency: 'USD', incoterm: 'FOB', payment_terms: '30% T/T deposit', deposit_amount: 2234, items: quoteIds[1].items.map(it => ({ ...it, unit_price: it.unit_price || 186 })) }
        : { customer_email: accepted.email, items: [] },
    });
    if (o.ok) {
      const oid = o.json.data.id;
      await api(`/orders/${oid}/status`, { method: 'POST', token, body: { status: 'confirmed', message: 'Deposit received 2026-11-02.' } });
      await api(`/orders/${oid}/status`, { method: 'POST', token, body: { status: 'in_production', message: 'Materials released to production.' } });
      await api(`/orders/${oid}`, { method: 'PUT', token, body: { carrier: 'DHL Global Forwarding', tracking_no: 'DHL7823410099', eta: '2026-12-20' } });
      log('  ✓ 订单 1 个（含状态时间线与物流信息）');
    } else {
      bun('order create', `${o.status} ${JSON.stringify(o.json).slice(0, 200)}`);
    }
  }

  /* ---- 订阅 ---- */
  log('\n[+] 订阅名单');
  let subs = 0;
  for (const s of SUBSCRIBERS) {
    const res = await api('/subscribe', { method: 'POST', body: { email: s.email, lang: s.lang, source: s.source } });
    if (res.ok) subs++;
  }
  log(`  ✓ 订阅提交 ${subs}/${SUBSCRIBERS.length}（pending 需在后台或邮件里确认，属正常状态）`);

  /* ---- 站点设置 ---- */
  log('\n[+] 站点设置与页面级 SEO');
  await api('/settings', {
    method: 'POST', token,
    body: {
      site_name: 'Hengrui Industrial',
      site_description: 'Pumps, valves, motors and control systems for water treatment, chemical and food processing plants. ISO 9001 factory, 15-25 day lead time, export to 40+ countries.',
      company_intro: 'Hengrui Industrial has manufactured pumps, valves and drive equipment in Zhejiang since 2008. We run our own foundry, machining and assembly lines, with in-house hydrostatic and performance testing. Roughly 60% of our output ships to Europe, the Middle East and South America.',
      email: 'sales@hengrui-industrial.example',
      phone: '+86 574 8888 6600',
      address: 'No. 88 Industrial Road, Ningbo, Zhejiang, China',
      linkedin: 'https://www.linkedin.com/company/hengrui-industrial',
      whatsapp: '8613800000000',
      founded_at: '2008',
      employees: '180+',
      countries_served: '42',
      annual_capacity: '300,000 units / year',
      // 默认主题：泵阀类走 industrial blue。改成 ocean/ember/forest/midnight/mono
      // 就能在后台一键换整站配色，不用重新部署。
      theme_default: 'classic',
      // 阶段五：营业时间与收款账户。写进种子数据后，联系页与订单 PDF 才有真东西可看，
      // 否则 PDF 永远停在「contact sales for bank details」这句兜底文案上。
      business_hours: 'Monday - Friday: 8:30 AM - 6:00 PM (GMT+8)\nSaturday: 9:00 AM - 12:00 PM\nSunday: Closed',
      beneficiary: 'Hengrui Industrial Co., Ltd.',
      bank_name: 'Bank of China, Ningbo Yinzhou Sub-branch',
      bank_account: '3901 6688 0012 3456 789',
      swift: 'BKCHCNBJ950',
      // 显式清空：本地 KV 里可能残留 G-TEST123456 之类的测试 ID，会让每次访问都去打 GA
      ga4_id: '',
      seo_pages: {
        '/': { title: 'Hengrui Industrial | Pumps, Valves & Control Systems Manufacturer', description: 'ISO 9001 factory in Ningbo, China. SS316L pumps, API 600 valves, IE3 motors and PLC cabinets. 15-25 day lead time, export to 42 countries.' },
        '/products': { title: 'Industrial Pumps, Valves & Drives | Hengrui Catalogue', description: 'Browse centrifugal pumps, pneumatic valves, gear reducers and PLC cabinets. Full specifications, MOQ and lead time on every model.' },
        '/cases': { title: 'Case Studies | Water, Automotive, Mining & Desalination', description: 'How buyers in Chile, Poland, Australia and the UAE cut downtime and spares inventory with our equipment.' },
        '/news': { title: 'News & Technical Notes | Hengrui Industrial', description: 'Product updates, trade show dates and practical sourcing notes for overseas buyers.' },
        '/about': { title: 'About Hengrui Industrial | ISO 9001 Factory in Ningbo', description: 'Own foundry, machining and assembly since 2008. 180 staff, 300,000 units per year, in-house QC lab and hydrostatic testing.' },
        '/contact': { title: 'Contact Hengrui Industrial | Quote in 1 Business Day', description: 'Send your drawing, duty point or I/O list. Our application engineers reply within one business day, in English, Spanish or Arabic.' },
        '/faq': { title: 'FAQ | MOQ, Lead Time, Payment & After-Sales', description: 'Answers to the questions overseas buyers ask most: minimum order, lead time, payment terms, OEM options and warranty.' },
      },
      seo_og_image: Object.values(imgUrl)[0][0],
    },
  });
  log('  ✓ 站点品牌、联系方式、Quick Facts、营业时间、收款账户、7 个页面 SEO 已写入');

  /* ---- 汇总 ---- */
  fs.writeFileSync(IMG_CACHE_FILE, JSON.stringify(imgCache, null, 2));
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const liveProducts = ((await api('/products?limit=200', { token })).json?.data || []).filter(p => p.is_active);
  const liveCases = ((await api('/content/cases', { token })).json?.data || []).filter(c => c.is_published);
  const livePosts = ((await api('/content/posts', { token })).json?.data || []).filter(p => p.is_published);
  const liveFaqs = ((await api('/content/faqs', { token })).json?.data || []).filter(f => f.is_active !== 0);
  const quoteTotal = (await api('/quotes?limit=200', { token })).json?.total ?? 0;
  const orderTotal = (await api('/orders?limit=200', { token })).json?.total ?? 0;

  log(`\n${'='.repeat(56)}`);
  log(`演示站准备完成（${dt}s，新建产品 ${prodCreated} / 更新 ${prodUpdated}）`);
  log(`  已上架产品 ${liveProducts.length} · 案例 ${liveCases.length} · 新闻 ${livePosts.length} · FAQ ${liveFaqs.length}`);
  log(`  询盘 ${inquiryCount} · 报价单 ${quoteTotal} · 订单 ${orderTotal}`);
  log(`  后台 ${BASE}/admin/login  账号 ${ADMIN_USER} / ${ADMIN_PASS}`);
  log(`  前台 ${BASE}/`);
  if (results.errors.length) {
    log(`\n  ⚠️ ${results.errors.length} 条失败：`);
    results.errors.slice(0, 15).forEach(e => log('    - ' + e));
    process.exitCode = 1;
  }
  log('='.repeat(56));
}

const argv = process.argv.slice(2);
const mode = argv.includes('--prepare') ? 'prepare' : (argv.includes('--reset') ? 'reset' : 'fill');
if (mode === 'prepare') {
  await prepare();
} else if (mode === 'reset') {
  await reset();
} else {
  await main();
}
