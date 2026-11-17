/** 시설·장비 설치비 견적(원). Phase 7 경제 모듈이 감가상각의 바탕으로 쓴다. */
import type { GhParams } from './params';
import type { GhSetup } from './types';

export interface CostLine {
  label: string;
  won: number;
}

export function installCost(p: GhParams, s: GhSetup): { lines: CostLine[]; total: number } {
  const a = s.area;
  const eq = p.eq;
  const lines: CostLine[] = [];
  const add = (label: string, won: number) => {
    if (won > 0) lines.push({ label, won });
  };
  add(`${p.facilities[s.facility].name} 골조·피복`, p.facilities[s.facility].buildCost * a);
  if (s.curtainLayers > 0) add(`보온커튼 ${eq.curtain.materials[s.curtainMaterial].name} ${s.curtainLayers}겹`, (eq.curtain.materials[s.curtainMaterial].cost * s.curtainLayers + eq.curtain.motor.installCost) * a);
  if (s.shade !== 'none') add(`차광막 ${eq.shade.screens[s.shade].name}`, (eq.shade.screens[s.shade].cost + eq.shade.motor.installCost) * a);
  if (s.sideVent || s.roofVent) add('창 자동 개폐기', eq.vent.installCost * a);
  if (s.insectNet !== 'none') add(eq.insectNet[s.insectNet].name, eq.insectNet[s.insectNet].cost * a);
  if (s.circFan) add(eq.circFan.name, eq.circFan.installCost * a);
  if (s.fog) add(eq.fog.name, eq.fog.installCost * a);
  if (s.heater !== 'none') add(`${eq.heater[s.heater].name} ${s.heaterCapacity} W/m²`, (eq.heater[s.heater].installCost * s.heaterCapacity * a) / 1000);
  if (s.cooling === 'padfan') add(eq.cooling.padfan.name, eq.cooling.padfan.installCost * a);
  if (s.cooling === 'heatpump') add(`${eq.cooling.heatpump.name} ${s.coolingCapacity} W/m²`, (eq.cooling.heatpump.installCost * s.coolingCapacity * a) / 1000);
  if (s.co2 !== 'none') add(`CO2 ${eq.co2[s.co2].name}`, eq.co2[s.co2].installCost * a);
  if (s.light !== 'none') add(`${eq.light[s.light].name} ${s.lightPpfd} μmol`, eq.light[s.light].installCost * s.lightPpfd * a);
  if (s.dehumidifier) add(eq.dehumidifier.name, eq.dehumidifier.installCost * a);
  if (s.solutionChiller) add(eq.solution.chiller.name, eq.solution.chiller.installCost * a);
  if (s.solutionHeater) add(eq.solution.heater.name, eq.solution.heater.installCost * a);
  return { lines, total: lines.reduce((x, l) => x + l.won, 0) };
}
