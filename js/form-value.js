// Values coming back from older rows may be NULL even when a newer select
// field has a declared default. A <select> cannot display NULL unless it has
// a blank option; assigning "" leaves it with no valid choice and the next
// save submits that empty string to Postgres.
export function selectFormValue(field, value) {
  if ((value === null || value === undefined) && field.default !== undefined) {
    return field.default;
  }
  return value ?? "";
}
