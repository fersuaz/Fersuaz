// Pide una contraseña por la terminal sin mostrarla en pantalla.
export function pedirClave(pregunta) {
  return new Promise((ok) => {
    const { stdin, stdout } = process;
    stdout.write(pregunta);
    if (!stdin.isTTY) { let t = ''; stdin.setEncoding('utf8'); stdin.on('data', (d) => { t += d; }); stdin.on('end', () => ok(t.split('\n')[0])); return; }
    let clave = '';
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const al = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', al); stdout.write('\n'); return ok(clave); }
        if (c === '\u0003') { stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') { if (clave) { clave = clave.slice(0, -1); stdout.write('\b \b'); } continue; }
        if (c >= ' ') { clave += c; stdout.write('•'); }
      }
    };
    stdin.on('data', al);
  });
}
