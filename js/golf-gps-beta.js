import { setupCourseGps } from "./golf-gps-course-map.js";

export const golfGpsBetaEnabled=true;
setupCourseGps({
  key:"center",
  label:"Square Butte Creek Golf Course · Center, ND",
  courseRe:/(square\s*butte|center\s*(nd)?|center square butte)/i,
  mapQuery:"Square Butte Creek Golf Course Center North Dakota",
  courseCenter:[47.09366,-101.24942],
  holeTargets:{
    1:{lat:47.0955339,lng:-101.2479445},
    2:{lat:47.0930578,lng:-101.2498542},
    3:{lat:47.0950007,lng:-101.2544569},
    4:{lat:47.0938539,lng:-101.2537488},
    5:{lat:47.09549,lng:-101.2491569},
    6:{lat:47.0927071,lng:-101.2484702},
    7:{lat:47.0908061,lng:-101.2512168},
    8:{lat:47.0923638,lng:-101.2564954},
    9:{lat:47.0935106,lng:-101.2509378}
  },
  storageKey:"dfl.golfGpsBeta.center.greens.v2"
});
