// Pure helpers for driver ride progress and when the app should open Maps.
export function shouldAutoOpenMaps(step, undo = false) {
  return undo !== true && (step === "En route" || step === "Picked up");
}

export function meetingPointForArrived(airport) {
  if (!airport || airport.side !== "pickup") return "";
  if (airport.meet && airport.meet.label) return String(airport.meet.label).trim();
  return String(airport.spotLabel || "").trim();
}
