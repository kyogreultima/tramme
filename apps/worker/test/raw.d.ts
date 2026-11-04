// a file imported as its text (Vite's ?raw), as the tests do
declare module '*?raw' {
  const text: string;
  export default text;
}
