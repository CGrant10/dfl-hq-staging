import { setupCourseGps } from "./golf-gps-course-map.js";

setupCourseGps({
  key:"new-salem",
  courseName:"Red Trail Links",
  label:"Red Trail Links · New Salem, ND",
  courseRe:/(red\s*trail|new\s*salem)/i,
  mapQuery:"Red Trail Links Golf Course New Salem North Dakota",
  courseCenter:[46.849018,-101.42071],
  holeTargets:{
    1:{lat:46.8524715,lng:-101.4226306},
    2:{lat:46.8533519,lng:-101.4242935},
    3:{lat:46.8540196,lng:-101.4234245},
    4:{lat:46.8505051,lng:-101.4223731},
    5:{lat:46.8495841,lng:-101.4256089},
    6:{lat:46.8492612,lng:-101.4218109},
    7:{lat:46.8485495,lng:-101.427701},
    8:{lat:46.847907,lng:-101.424079},
    9:{lat:46.8481679,lng:-101.4199441}
  },
  storageKey:"dfl.golfGpsBeta.redTrail.greens.v2"
});
