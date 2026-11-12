'use strict';

// Standard training splits with a sensible default plan each.
// Volumes follow common hypertrophy guidance: compounds 3–4 × 5–10, accessories 2–3 × 10–15.
// Sources: StrengthLog upper/lower 4x, Outlift PPL, J3U torso/limb split, Fitnessvolt full body / upper-lower.

const ex = (name, sets, reps) => ({ name, sets, reps });

const S = {
  fullA: ['Ganzkörper A', [
    ex('Kniebeuge', 3, '6–8'), ex('Bankdrücken', 3, '6–8'), ex('Rudern am Kabel', 3, '8–12'),
    ex('Rumänisches Kreuzheben', 3, '8–10'), ex('Seitheben', 2, '12–15'), ex('Bizepscurls', 2, '10–12'),
  ]],
  fullB: ['Ganzkörper B', [
    ex('Kreuzheben', 3, '5'), ex('Schulterdrücken', 3, '6–10'), ex('Latzug', 3, '8–12'),
    ex('Beinpresse', 3, '10–12'), ex('Trizepsdrücken am Kabel', 2, '10–12'), ex('Plank', 3, '30–45 s'),
  ]],
  fullC: ['Ganzkörper C', [
    ex('Frontkniebeuge', 3, '6–8'), ex('Schrägbankdrücken Kurzhantel', 3, '8–10'), ex('Klimmzüge', 3, '6–10'),
    ex('Hip Thrust', 3, '8–12'), ex('Wadenheben', 3, '12–15'), ex('Face Pulls', 2, '12–15'),
  ]],
  upperA: ['Upper A', [
    ex('Bankdrücken', 4, '5–8'), ex('Langhantelrudern', 4, '6–8'), ex('Schulterdrücken', 3, '8–10'),
    ex('Latzug', 3, '8–12'), ex('Bizepscurls', 3, '10–12'), ex('Trizepsdrücken am Kabel', 3, '10–12'),
  ]],
  lowerA: ['Lower A', [
    ex('Kniebeuge', 4, '5–8'), ex('Rumänisches Kreuzheben', 3, '8–10'), ex('Beinpresse', 3, '10–12'),
    ex('Beinbeuger', 3, '10–12'), ex('Wadenheben', 4, '10–15'), ex('Plank', 3, '30–45 s'),
  ]],
  upperB: ['Upper B', [
    ex('Schrägbankdrücken Kurzhantel', 3, '8–10'), ex('Klimmzüge', 3, '6–10'), ex('Kurzhantel-Schulterdrücken', 3, '8–12'),
    ex('Rudern am Kabel', 3, '10–12'), ex('Seitheben', 3, '12–15'), ex('Hammercurls', 3, '10–12'),
  ]],
  lowerB: ['Lower B', [
    ex('Kreuzheben', 3, '4–6'), ex('Bulgarische Split Squats', 3, '8–10'), ex('Beinstrecker', 3, '12–15'),
    ex('Hip Thrust', 3, '8–12'), ex('Beinbeuger', 3, '10–12'), ex('Wadenheben sitzend', 3, '12–15'),
  ]],
  pushA: ['Push A', [
    ex('Bankdrücken', 4, '6–8'), ex('Schulterdrücken', 3, '8–10'), ex('Schrägbankdrücken Kurzhantel', 3, '8–12'),
    ex('Seitheben', 3, '12–15'), ex('Trizepsdrücken am Kabel', 3, '10–12'), ex('Überkopf-Trizepsstrecken', 2, '10–12'),
  ]],
  pullA: ['Pull A', [
    ex('Kreuzheben', 3, '5'), ex('Klimmzüge', 3, '6–10'), ex('Langhantelrudern', 3, '8–10'),
    ex('Face Pulls', 3, '12–15'), ex('Bizepscurls', 3, '10–12'), ex('Hammercurls', 2, '10–12'),
  ]],
  legsA: ['Legs A', [
    ex('Kniebeuge', 4, '6–8'), ex('Rumänisches Kreuzheben', 3, '8–10'), ex('Beinpresse', 3, '10–12'),
    ex('Beinbeuger', 3, '10–12'), ex('Wadenheben', 4, '10–15'),
  ]],
  pushB: ['Push B', [
    ex('Schulterdrücken', 4, '6–8'), ex('Schrägbankdrücken', 3, '8–10'), ex('Dips', 3, '8–12'),
    ex('Butterfly', 3, '12–15'), ex('Seitheben', 3, '12–15'), ex('Trizepsdrücken am Kabel', 3, '10–12'),
  ]],
  pullB: ['Pull B', [
    ex('Latzug', 4, '8–10'), ex('Rudern am Kabel', 3, '10–12'), ex('Einarmiges Kurzhantelrudern', 3, '8–12'),
    ex('Reverse Butterfly', 3, '12–15'), ex('Hammercurls', 3, '10–12'), ex('Bizepscurls', 2, '12–15'),
  ]],
  legsB: ['Legs B', [
    ex('Frontkniebeuge', 3, '6–8'), ex('Hip Thrust', 3, '8–12'), ex('Bulgarische Split Squats', 3, '8–10'),
    ex('Beinstrecker', 3, '12–15'), ex('Beinbeuger', 3, '10–12'), ex('Wadenheben sitzend', 3, '12–15'),
  ]],
  torsoA: ['Torso A', [
    ex('Bankdrücken', 4, '5–8'), ex('Langhantelrudern', 4, '6–8'), ex('Schrägbankdrücken Kurzhantel', 3, '8–10'),
    ex('Latzug', 3, '8–12'), ex('Face Pulls', 3, '12–15'), ex('Kabel-Crunches', 3, '10–15'),
  ]],
  limbsA: ['Limbs A', [
    ex('Kniebeuge', 4, '5–8'), ex('Rumänisches Kreuzheben', 3, '8–10'), ex('Beinpresse', 3, '10–12'),
    ex('Bizepscurls', 3, '10–12'), ex('Dips', 3, '8–12'), ex('Wadenheben', 3, '10–15'),
  ]],
  torsoB: ['Torso B', [
    ex('Schrägbankdrücken', 3, '6–10'), ex('Klimmzüge', 3, '6–10'), ex('Butterfly', 3, '12–15'),
    ex('Rudern am Kabel', 3, '10–12'), ex('Reverse Butterfly', 3, '12–15'), ex('Hängendes Beinheben', 3, '10–15'),
  ]],
  limbsB: ['Limbs B', [
    ex('Kreuzheben', 3, '4–6'), ex('Bulgarische Split Squats', 3, '8–10'), ex('Beinbeuger', 3, '10–12'),
    ex('Seitheben', 3, '12–15'), ex('Hammercurls', 3, '10–12'), ex('Überkopf-Trizepsstrecken', 3, '10–12'),
  ]],
  chestBack: ['Brust & Rücken', [
    ex('Bankdrücken', 4, '6–8'), ex('Klimmzüge', 4, '6–10'), ex('Schrägbankdrücken Kurzhantel', 3, '8–10'),
    ex('Langhantelrudern', 3, '8–10'), ex('Butterfly', 3, '12–15'), ex('Latzug', 3, '10–12'),
  ]],
  shouldersArms: ['Schultern & Arme', [
    ex('Schulterdrücken', 4, '6–10'), ex('Seitheben', 4, '12–15'), ex('Reverse Butterfly', 3, '12–15'),
    ex('Bizepscurls', 3, '8–12'), ex('Dips', 3, '8–12'), ex('Hammercurls', 3, '10–12'),
  ]],
  legs: ['Beine', [
    ex('Kniebeuge', 4, '6–8'), ex('Rumänisches Kreuzheben', 3, '8–10'), ex('Beinpresse', 3, '10–12'),
    ex('Beinstrecker', 3, '12–15'), ex('Beinbeuger', 3, '10–12'), ex('Wadenheben', 4, '10–15'),
  ]],
  chest: ['Brust', [
    ex('Bankdrücken', 4, '6–8'), ex('Schrägbankdrücken Kurzhantel', 3, '8–10'), ex('Dips', 3, '8–12'), ex('Butterfly', 3, '12–15'),
  ]],
  back: ['Rücken', [
    ex('Kreuzheben', 3, '5'), ex('Klimmzüge', 3, '6–10'), ex('Langhantelrudern', 3, '8–10'), ex('Rudern am Kabel', 3, '10–12'),
  ]],
  shoulders: ['Schultern', [
    ex('Schulterdrücken', 4, '6–10'), ex('Seitheben', 4, '12–15'), ex('Reverse Butterfly', 3, '12–15'), ex('Face Pulls', 3, '12–15'),
  ]],
  arms: ['Arme', [
    ex('Bizepscurls', 3, '8–12'), ex('Trizepsdrücken am Kabel', 3, '10–12'), ex('Hammercurls', 3, '10–12'),
    ex('Überkopf-Trizepsstrecken', 3, '10–12'), ex('Kabel-Crunches', 3, '10–15'),
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
