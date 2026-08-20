/* Input regressions the harness can actually assert without a browser. */
import { Input, DEFAULT_BINDINGS } from '../src/core/Input.js';
globalThis.window = undefined;
const R=[];const ok=(n,c,d)=>R.push(`${c?'PASS':'FAIL'}  ${n.padEnd(40)} ${d}`);
// No DOM: build a bare object with the same shape Input binds against.
const stub={addEventListener(){},removeEventListener(){}};
globalThis.document=stub;
const inp=Object.create(Input.prototype);
inp.bindings=structuredClone(DEFAULT_BINDINGS);
inp.down=new Set();inp.pressed=new Set();inp.released=new Set();
inp.uiCaptured=false;inp.scripted=null;inp.autoRun=false;inp.lookSensitivity=1;
inp._touchPressed=new Map();inp.touch=null;
inp.mouse={dx:0,dy:0,x:0,y:0,wheel:0,buttons:new Set(),pressedButtons:new Set(),releasedButtons:new Set(),locked:false};

// 1. no two actions share a code
const seen=new Map();let clash=[];
for(const [a,list] of Object.entries(inp.bindings))for(const c of list){
  if(seen.has(c))clash.push(`${c}: ${seen.get(c)} + ${a}`); else seen.set(c,a);}
ok('no duplicate key bindings',clash.length===0,clash.length?clash.join(', '):`${seen.size} codes over ${Object.keys(inp.bindings).length} actions`);

// 2. strafeLeft no longer fires attack
inp.pressed.add('KeyA');inp.down.add('KeyA');
ok('KeyA strafes without attacking',inp.action('strafeLeft')&&!inp.actionPressed('attack'),
   `strafeLeft=${inp.action('strafeLeft')} attack=${inp.actionPressed('attack')}`);
inp.pressed.clear();inp.down.clear();

// 3. Enter toggles turn-based only
inp.pressed.add('Enter');inp.down.add('Enter');
ok('Enter is turn-based only',inp.actionPressed('turnBased')&&!inp.actionPressed('interact'),
   `turnBased=${inp.actionPressed('turnBased')} interact=${inp.actionPressed('interact')}`);
inp.pressed.clear();inp.down.clear();

// 4. auto-run latches and survives the key going up
inp.pressed.add('Slash');inp.endFrame();
ok('auto-run latches',inp.autoRun&&inp.action('run'),`autoRun=${inp.autoRun} run=${inp.action('run')}`);
inp.down.add('ControlLeft');inp.endFrame();
ok('sneak cancels auto-run',!inp.autoRun,`autoRun=${inp.autoRun}`);
inp.down.clear();

// 5. rebinding steals the code from whoever held it
inp.setBinding('attack',['KeyA']);
ok('setBinding evicts the old owner',!inp.bindings.strafeLeft.includes('KeyA')&&inp.bindings.attack.includes('KeyA'),
   `strafeLeft=[${inp.bindings.strafeLeft}] attack=[${inp.bindings.attack}]`);
ok('bindingFor resolves',inp.bindingFor('KeyA')==='attack',String(inp.bindingFor('KeyA')));
inp.resetBindings();
ok('resetBindings restores defaults',inp.bindings.strafeLeft.includes('KeyA'),`strafeLeft=[${inp.bindings.strafeLeft}]`);

// 6. look sensitivity scales both sources, and never the capture harness
inp.mouse.dx=100;inp.lookSensitivity=0.5;
ok('lookSensitivity scales the mouse',inp.lookDelta().dx===50,String(inp.lookDelta().dx));
inp.scripted={look:{dx:100,dy:0}};
ok('capture path is unscaled',inp.lookDelta().dx===100,String(inp.lookDelta().dx));

for(const l of R)console.log('  '+l);
console.log(`\n${R.filter(l=>l.startsWith('PASS')).length}/${R.length} pass`);
