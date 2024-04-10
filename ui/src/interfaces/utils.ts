export type ToStringTypes<T> = {
  [P in keyof T]: string
}
