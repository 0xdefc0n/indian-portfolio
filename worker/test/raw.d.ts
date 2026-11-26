// Vite `?raw` imports (test fixtures as strings).
declare module '*?raw' {
  const text: string
  export default text
}
