import { setupCourseGps } from "./golf-gps-course-map.js";

setupCourseGps({
  key:"rolla",
  courseName:"Rolla Country Club",
  label:"Rolla Country Club · Rolla, ND",
  courseRe:/(rolla\s*(country|municipal)?|rolla.*golf)/i,
  mapQuery:"Rolla Country Club Rolla North Dakota",
  courseCenter:[48.89628,-99.68236],
  // Published landing targets establish each fairway's bearing. The GPS
  // projects the tee along that bearing using the event's official yardage.
  fairwayTargets:{
    1:{lat:48.894550702551264,lng:-99.68332740495052},
    2:{lat:48.89722812388267,lng:-99.68126123911524},
    3:{lat:48.89824089778316,lng:-99.68205699039018},
    4:{lat:48.89933299168972,lng:-99.6850548351459},
    5:{lat:48.895891660270074,lng:-99.6826989907747},
    6:{lat:48.89419767397818,lng:-99.6842672182803},
    7:{lat:48.89729126189979,lng:-99.68169143276748},
    8:{lat:48.89616337240164,lng:-99.68121849906876},
    9:{lat:48.89393331641027,lng:-99.68251850566227}
  },
  holeTargets:{
    1:{lat:48.8950433281,lng:-99.6823220528},
    2:{lat:48.8978194722,lng:-99.6822970481},
    3:{lat:48.8994035212,lng:-99.6842676068},
    4:{lat:48.89788069384954,lng:-99.68377187442256},
    5:{lat:48.8949171452,lng:-99.6836301936},
    6:{lat:48.8950288796,lng:-99.6823177286},
    7:{lat:48.8978244235,lng:-99.6822712662},
    8:{lat:48.8942789479,lng:-99.6805618342},
    9:{lat:48.8939233707,lng:-99.6835221281}
  },
  storageKey:"dfl.golfGpsBeta.rolla.greens.v1"
});
