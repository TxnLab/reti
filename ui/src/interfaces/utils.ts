export type ToString<T> = T extends Array<infer U> ? Array<ToString<U>> : string

export type ToStringTypes<T> = {
  [P in keyof T]: ToString<T[P]>
}
