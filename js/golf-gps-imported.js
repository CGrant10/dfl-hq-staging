import { setupCourseGps } from "./golf-gps-course-map.js";

const builtIn=/(square\s*butte|center\s*(nd)?|center square butte|red\s*trail|new\s*salem|rolla\s*(country|municipal)?|rolla.*golf)/i;

// Saved/imported courses use the same hole-focused renderer. Tee and green
// coordinates come from golf_course_holes, keyed by the active course id.
setupCourseGps({
  key:"imported",
  label:"Imported golf course",
  courseRe:{test:text=>Boolean(String(text||"").trim())&&!builtIn.test(text)},
  storageKey:"dfl.golfGps.imported.greens.v1"
});
