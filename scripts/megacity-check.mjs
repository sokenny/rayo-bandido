import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = '/tmp/rb-megacity';
mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.RB_BROWSER ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--ignore-gpu-blocklist', '--use-angle=default'], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto('http://127.0.0.1:5173/?mode=city&solo=1&debug=1&intro=0');
  await page.waitForFunction(() => window.__rb?.ready?.(), { timeout: 60000 });
  await page.click('#game-canvas');
  for (const v of [
    { name: 'ground', x: -70, z: -80, y: 0, heading: 0 },
    { name: 'passage', x: -160, z: -205, y: 15, heading: Math.PI / 2 },
    { name: 'bridge', x: -76, z: -205, y: 15, heading: Math.PI / 2 },
  ]) {
    await page.evaluate((v) => { const s = window.__rb.state.vehicle; Object.assign(s, v, {prevX:v.x,prevZ:v.z,prevY:v.y,prevHeading:v.heading,vx:0,vz:0,speed:0}); }, v);
    await new Promise((r) => setTimeout(r, 1800));
    await page.screenshot({ path: `${out}/${v.name}.png` });
    console.log(v.name, await page.evaluate(() => JSON.stringify(window.__rb.metrics)));
  }
  await page.keyboard.press('r');
  await new Promise((r) => setTimeout(r, 350));
  const recoveryY = await page.evaluate(() => window.__rb.state.vehicle.y);
  if (Math.abs(recoveryY - 15) > 0.1) throw new Error(`Elevated recovery changed level: ${recoveryY}`);
  console.log('elevated R recovery', recoveryY);
  const result = await page.evaluate(async () => {
    const { createCityWorld } = await import('/src/world/cityWorld.ts');
    const { createInitialGameState, stepGame } = await import('/src/sim/gameState.ts');
    const { createPlayerCommand } = await import('/src/core/input/keyboard.ts');
    const { createProjection, projectOntoPath, pointAtStation } = await import('/src/world/track.ts');
    const { layout, plan } = createCityWorld();
    // Static traversal check uses the actual simulation, without traffic encounters.
    layout.targetSpawns = []; layout.targetPatrols = []; layout.busRoutes = [];
    layout.walls = layout.walls.filter(w => w.tag !== 'bus');
    const state = createInitialGameState(layout);
    const v = state.vehicle, command = createPlayerCommand();
    const enter = plan.ribbons.find(r => r.tag === 'ramp-w-on').path;
    const loop = plan.ribbons.find(r => r.tag === 'viaduct').path;
    const leave = plan.ribbons.find(r => r.tag === 'ramp-n-off').path;
    const p = createProjection(), aim = createProjection();
    Object.assign(v, {x:enter.samples[0].x,z:enter.samples[0].z,y:0,heading:Math.atan2(enter.samples[0].tx,-enter.samples[0].tz)});
    let collisions = 0;
    const stages = [];
    for (const [name, path] of [['entry',enter],['loop',loop],['exit',leave]]) {
      projectOntoPath(path,v.x,v.z,p);
      let travelled = 0, last = p.s, done = false;
      projectOntoPath(loop,leave.samples[0].x,leave.samples[0].z,aim);
      const loopGoal = loop.length + ((aim.s - p.s + loop.length) % loop.length);
      let maxError = 0;
      for (let tick=0; tick<120*240; tick++) {
        projectOntoPath(path,v.x,v.z,p);
        let ds=p.s-last;
        if (path.closed && ds < -path.length/2) ds+=path.length;
        if (path.closed && ds > path.length/2) ds-=path.length;
        travelled+=ds; last=p.s;
        if ((!path.closed && p.s > path.length-4) || (path.closed && travelled >= loopGoal-3)) { done=true; break; }
        pointAtStation(path,p.s+8,aim);
        const angle=Math.atan2(aim.x-v.x,-(aim.z-v.z));
        const error=Math.atan2(Math.sin(angle-v.heading),Math.cos(angle-v.heading));
        command.steer=Math.max(-1,Math.min(1,error*1.8-v.yawRate*0.28));
        command.throttle=v.speed<12 ? 0.65 : 0;
        command.brake=v.speed>14 ? 0.25 : 0;
        stepGame(state,command,layout,1/120,{respawnTraffic:false});
        if(state.events.some(e=>e.type==='collision')) collisions++;
        maxError=Math.max(maxError,p.dist);
      }
      stages.push({name,done,travelled,x:v.x,z:v.z,y:v.y,maxError});
      if(!done) break;
    }
    return {stages,collisions,volumes:plan.megastructures.map(m=>m.volumes.length)};
  });
  console.log(JSON.stringify(result));
  writeFileSync(`${out}/result.json`,JSON.stringify({result,errors},null,2));
  if (errors.length || result.collisions || result.stages.length !== 3 || result.stages.some(s => !s.done)) process.exitCode = 1;
} finally { await browser.close(); }
console.log('errors', errors);
