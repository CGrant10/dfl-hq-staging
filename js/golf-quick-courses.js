export const quickCourseId = (round, player) =>
  Number(player?.course_id) || Number(round?.course_id) || 0;

export function quickCourseHoleMap(rows = []) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row.course_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

export const quickHolesFor = (round, player, holesByCourse) =>
  holesByCourse.get(String(quickCourseId(round, player))) || [];

export function quickCourseGroups(round, players, courses = []) {
  const names = new Map(courses.map(course => [String(course.id), course.name]));
  const groups = new Map();
  for (const player of players) {
    const courseId = quickCourseId(round, player);
    const key = String(courseId);
    if (!groups.has(key)) groups.set(key, {
      courseId,
      name: names.get(key) || "Golf course",
      players: [],
    });
    groups.get(key).players.push(player);
  }
  return [...groups.values()];
}
