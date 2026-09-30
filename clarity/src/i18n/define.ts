/** Словарь пространства имён: казахская часть обязана содержать все ключи русской. */
export function defineDict<T extends Record<string, string>>(d: { ru: T; kk: { [K in keyof T]: string } }) {
  return d;
}
