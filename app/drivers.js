// Fleet roster fields. Ride assignment and passcodes stay on the driver id, not the name.
export const DRIVER_NAME_MAX = 80;
export const DRIVER_VEHICLE_MAX = 40;
export const DRIVER_PLATE_MAX = 12;
export const PASSCODE_MIN = 4;
export const PASSCODE_MAX = 32;
export const ROSTER_EMAIL_SUFFIX = "@drivers.invalid";

const PLATE_RE = /^[A-Z0-9]+(?:[ -][A-Z0-9]+)*$/;

function limitedText(value, max, label, required) {
  if (value == null || value === "") {
    return required ? { value: "", error: `Enter the ${label}.` } : { value: "", error: "" };
  }
  if (typeof value !== "string") return { value: "", error: `Enter the ${label}.` };
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
  if (!cleaned) return required ? { value: "", error: `Enter the ${label}.` } : { value: "", error: "" };
  if (cleaned.length > max) return { value: "", error: `Use a ${label} of at most ${max} characters.` };
  return { value: cleaned, error: "" };
}

export function driverFields(body) {
  const source = body && typeof body === "object" ? body : {};
  const name = limitedText(source.name, DRIVER_NAME_MAX, "driver name", true);
  if (name.error) return { name: "", vehicle: "", plate: "", error: name.error };
  const vehicle = limitedText(source.vehicle, DRIVER_VEHICLE_MAX, "vehicle type", false);
  if (vehicle.error) return { name: name.value, vehicle: "", plate: "", error: vehicle.error };
  const plate = limitedText(source.plate, DRIVER_PLATE_MAX, "plate", false);
  if (plate.error) return { name: name.value, vehicle: vehicle.value, plate: "", error: plate.error };
  const plateValue = plate.value.toUpperCase();
  if (plateValue && !PLATE_RE.test(plateValue)) {
    return {
      name: name.value,
      vehicle: vehicle.value,
      plate: "",
      error: "Use letters and numbers for the plate. Spaces and hyphens are ok.",
    };
  }
  return { name: name.value, vehicle: vehicle.value, plate: plateValue, error: "" };
}

export function passcodeProblem(passcode, name) {
  if (typeof passcode !== "string") return "Use a passcode of 4 to 32 letters or numbers.";
  const value = passcode.trim();
  if (!/^[A-Za-z0-9]{4,32}$/.test(value)) return "Use a passcode of 4 to 32 letters or numbers.";
  const compactName = String(name || "").replace(/\s+/g, "").toLowerCase();
  if (compactName && value.toLowerCase() === compactName) {
    return "Use a passcode that is not the driver's name.";
  }
  return "";
}

export function isRosterEmail(email) {
  return typeof email === "string" && email.toLowerCase().endsWith(ROSTER_EMAIL_SUFFIX);
}

export function rosterEmailFor(userId) {
  return `roster+${userId}@drivers.invalid`;
}
