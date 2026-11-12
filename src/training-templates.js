'use strict';

// Standard training splits with a sensible default plan each.
// Every exercise: 2–3 sets; heavy compounds 6–8 reps, everything else 8–10 (never more than 10).
// Sources: StrengthLog upper/lower 4x, Outlift PPL, J3U torso/limb split, Fitnessvolt full body / upper-lower.

const ex = (name, sets, reps) => ({ name, sets, reps });

const S = {
  fullA: ['Ganzkörper A', [
    ex('Kniebeuge', 3, '6–8'), ex('Bankdrücken', 3, '6–8'), ex('Rudern am Kabel', 3, '8–10'), ex('Rumänisches Kreuzheben', 3, '8–10'), ex('Seitheben', 2, '8–10'), ex('Bizepscurls', 2, '8–10'),
  ]],
  fullB: ['Ganzkörper B', [
    ex('Kreuzheben', 2, '6–8'), ex('Schulterdrücken', 3, '6–8'), ex('Latzug', 3, '8–10'), ex('Beinpresse', 3, '8–10'), ex('Trizepsdrücken am Kabel', 2, '8–10'), ex('Hängendes Beinheben', 2, '8–10'),
  ]],
  fullC: ['Ganzkörper C', [
    ex('Frontkniebeuge', 3, '6–8'), ex('Schrägbankdrücken Kurzhantel', 3, '8–10'), ex('Klimmzüge', 3, '6–8'), ex('Hip Thrust', 3, '8–10'), ex('Wadenheben', 3, '8–10'), ex('Face Pulls', 2, '8–10'),
  ]],
  upperA: ['Upper A', [
    ex('Bankdrücken', 3, '6–8'), ex('Langhantelrudern', 3, '6–8'), ex('Schulterdrücken', 3, '6–8'), ex('Latzug', 3, '8–10'), ex('Bizepscurls', 2, '8–10'), ex('Trizepsdrücken am Kabel', 2, '8–10'),
  ]],
  lowerA: ['Lower A', [
    ex('Kniebeuge', 3, '6–8'), ex('Rumänisches Kreuzheben', 3, '8–10'), ex('Beinpresse', 3, '8–10'), ex('Beinbeuger', 3, '8–10'), ex('Wadenheben', 3, '8–10'), ex('Hängendes Beinheben', 2, '8–10'),
  ]],
  upperB: ['Upper B', [
    ex('Schrägbankdrücken Kurzhantel', 3, '8–10'), ex('Klimmzüge', 3, '6–8'), ex('Kurzhantel-Schulterdrücken', 3, '8–10'), ex('Rudern am Kabel', 3, '8–10'), ex('Seitheben', 3, '8–10'), ex('Hammercurls', 2, '8–10'),
  ]],
  lowerB: ['Lower B', [
    ex('Kreuzheben', 2, '6–8'), ex('Bulgarische Split Squats', 3, '8–10'), ex('Beinstrecker', 3, '8–10'), ex('Hip Thrust', 3, '8–10'), ex('Beinbeuger', 3, '8–10'), ex('Wadenheben sitzend', 3, '8–10'),
  ]],
  pushA: ['Push A', [
    ex('Bankdrücken', 3, '6–8'), ex('Schulterdrücken', 3, '6–8'), ex('Schrägbankdrücken Kurzhantel', 3, '8–10'), ex('Seitheben', 3, '8–10'), ex('Trizepsdrücken am Kabel', 2, '8–10'), ex('Überkopf-Trizepsstrecken', 2, '8–10'),
  ]],
  pullA: ['Pull A', [
    ex('Kreuzheben', 2, '6–8'), ex('Klimmzüge', 3, '6–8'), ex('Langhantelrudern', 3, '8–10'), ex('Face Pulls', 3, '8–10'), ex('Bizepscurls', 3, '8–10'), ex('Hammercurls', 2, '8–10'),
  ]],
  legsA: ['Legs A', [
    ex('Kniebeuge', 3, '6–8'), ex('Rumänisches Kreuzheben', 3, '8–10'), ex('Beinpresse', 3, '8–10'), ex('Beinbeuger', 3, '8–10'), ex('Wadenheben', 3, '8–10'),
  ]],
  pushB: ['Push B', [
    ex('Schulterdrücken', 3, '6–8'), ex('Schrägbankdrücken', 3, '6–8'), ex('Dips', 3, '8–10'), ex('Butterfly', 3, '8–10'), ex('Seitheben', 3, '8–10'), ex('Trizepsdrücken am Kabel', 2, '8–10'),
  ]],
  pullB: ['Pull B', [
    ex('Latzug', 3, '8–10'), ex('Rudern am Kabel', 3, '8–10'), ex('Einarmiges Kurzhantelrudern', 3, '8–10'), ex('Reverse Butterfly', 3, '8–10'), ex('Hammercurls', 3, '8–10'), ex('Bizepscurls', 2, '8–10'),
  ]],
  legsB: ['Legs B', [
    ex('Frontkniebeuge', 3, '6–8'), ex('Hip Thrust', 3, '8–10'), ex('Bulgarische Split Squats', 3, '8–10'), ex('Beinstrecker', 3, '8–10'), ex('Beinbeuger', 2, '8–10'), ex('Wadenheben sitzend', 3, '8–10'),
  ]],
  torsoA: ['Torso A', [
    ex('Bankdrücken', 3, '6–8'), ex('Langhantelrudern', 3, '6–8'), ex('Schrägbankdrücken Kurzhantel', 3, '8–10'), ex('Latzug', 3, '8–10'), ex('Face Pulls', 2, '8–10'), ex('Kabel-Crunches', 3, '8–10'),
  ]],
  limbsA: ['Limbs A', [
    ex('Kniebeuge', 3, '6–8'), ex('Rumänisches Kreuzheben', 3, '8–10'), ex('Beinpresse', 2, '8–10'), ex('Bizepscurls', 3, '8–10'), ex('Dips', 3, '8–10'), ex('Wadenheben', 3, '8–10'),
  ]],
  torsoB: ['Torso B', [
    ex('Schrägbankdrücken', 3, '6–8'), ex('Klimmzüge', 3, '6–8'), ex('Butterfly', 3, '8–10'), ex('Rudern am Kabel', 3, '8–10'), ex('Reverse Butterfly', 2, '8–10'), ex('Hängendes Beinheben', 3, '8–10'),
  ]],
  limbsB: ['Limbs B', [
    ex('Kreuzheben', 2, '6–8'), ex('Bulgarische Split Squats', 3, '8–10'), ex('Beinbeuger', 3, '8–10'), ex('Seitheben', 3, '8–10'), ex('Hammercurls', 3, '8–10'), ex('Überkopf-Trizepsstrecken', 3, '8–10'),
  ]],
  chestBack: ['Brust & Rücken', [
    ex('Bankdrücken', 3, '6–8'), ex('Klimmzüge', 3, '6–8'), ex('Schrägbankdrücken Kurzhantel', 3, '8–10'), ex('Langhantelrudern', 3, '8–10'), ex('Butterfly', 2, '8–10'), ex('Latzug', 2, '8–10'),
  ]],
  shouldersArms: ['Schultern & Arme', [
    ex('Schulterdrücken', 3, '6–8'), ex('Seitheben', 3, '8–10'), ex('Reverse Butterfly', 2, '8–10'), ex('Bizepscurls', 3, '8–10'), ex('Dips', 3, '8–10'), ex('Hammercurls', 2, '8–10'),
  ]],
  legs: ['Beine', [
    ex('Kniebeuge', 3, '6–8'), ex('Rumänisches Kreuzheben', 3, '8–10'), ex('Beinpresse', 3, '8–10'), ex('Beinstrecker', 2, '8–10'), ex('Beinbeuger', 3, '8–10'), ex('Wadenheben', 3, '8–10'),
  ]],
  chest: ['Brust', [
    ex('Bankdrücken', 3, '6–8'), ex('Schrägbankdrücken Kurzhantel', 3, '8–10'), ex('Dips', 3, '8–10'), ex('Butterfly', 3, '8–10'),
  ]],
  back: ['Rücken', [
    ex('Kreuzheben', 2, '6–8'), ex('Klimmzüge', 3, '6–8'), ex('Langhantelrudern', 3, '8–10'), ex('Rudern am Kabel', 3, '8–10'),
  ]],
  shoulders: ['Schultern', [
    ex('Schulterdrücken', 3, '6–8'), ex('Seitheben', 3, '8–10'), ex('Reverse Butterfly', 3, '8–10'), ex('Face Pulls', 3, '8–10'),
  ]],
  arms: ['Arme', [
    ex('Bizepscurls', 3, '8–10'), ex('Trizepsdrücken am Kabel', 3, '8–10'), ex('Hammercurls', 3, '8–10'), ex('Überkopf-Trizepsstrecken', 3, '8–10'), ex('Kabel-Crunches', 3, '8–10'),
  ]],
};

const SPLITS = [
  { key: 'fullbody', name: 'Ganzkörper', days: [2, 3], desc: 'Jede Muskelgruppe in jedem Training – ideal für Einsteiger und wenig Zeit.', sessions: ['fullA', 'fullB', 'fullC'] },
  { key: 'upper_lower', name: 'Upper / Lower', days: [4], desc: 'Oberkörper und Unterkörper im Wechsel, jede Muskelgruppe 2× pro Woche.', sessions: ['upperA', 'lowerA', 'upperB', 'lowerB'] },
  { key: 'ppl', name: 'Push / Pull / Legs', days: [3, 6], desc: 'Drücken, Ziehen, Beine. Mit 6 Tagen jede Muskelgruppe 2× pro Woche.', sessions: ['pushA', 'pullA', 'legsA', 'pushB', 'pullB', 'legsB'] },
  { key: 'torso_limbs', name: 'Torso / Limbs', days: [4], desc: 'Rumpf (Brust, Rücken, Bauch) und Extremitäten (Beine, Arme, Seitliche Schulter).', sessions: ['torsoA', 'limbsA', 'torsoB', 'limbsB'] },
  { key: 'ul_ppl', name: 'Upper / Lower + PPL', days: [5], desc: 'Hybrid für 5 Tage: Upper, Lower, dann Push, Pull, Legs.', sessions: ['upperA', 'lowerA', 'pushB', 'pullB', 'legsB'] },
  { key: 'arnold', name: 'Arnold-Split', days: [3, 6], desc: 'Brust & Rücken, Schultern & Arme, Beine – klassisch mit 6 Tagen.', sessions: ['chestBack', 'shouldersArms', 'legs'] },
  { key: 'bro', name: 'Bro-Split', days: [5], desc: 'Ein Muskel pro Tag: Brust, Rücken, Schultern, Beine, Arme.', sessions: ['chest', 'back', 'shoulders', 'legs', 'arms'] },
];
const CUSTOM = { key: 'custom', name: 'Eigener Split', days: [], desc: 'Tage selbst benennen und Übungen frei zusammenstellen.', sessions: [] };

let seq = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Default plan for a split and number of training days (sessions repeat if there are more days). */
function buildPlan(splitKey, daysPerWeek) {
  const split = SPLITS.find((s) => s.key === splitKey);
  const days = [];
  for (let i = 0; i < daysPerWeek; i++) {
    if (!split) {
      days.push({ id: uid('d'), name: `Tag ${i + 1}`, exercises: [] });
      continue;
    }
    const [name, list] = S[split.sessions[i % split.sessions.length]];
    days.push({ id: uid('d'), name, exercises: list.map((e) => ({ id: uid('e'), ...e, note: '' })) });
  }
  return days;
}

/** Every exercise name used by the templates – suggestions when adding an exercise. */
const EXERCISES = [...new Set(Object.values(S).flatMap(([, list]) => list.map((e) => e.name)))].sort((a, b) => a.localeCompare(b, 'de'));

const splitInfo = () => [...SPLITS, CUSTOM].map(({ key, name, days, desc }) => ({ key, name, days, desc }));

module.exports = { SPLITS, CUSTOM, buildPlan, EXERCISES, splitInfo };
