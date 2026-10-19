// Set up accessible controls; documentation lives on penjelasan.html.
export function organizeForm() {
  const form = document.getElementById('scenario');
  form.setAttribute('aria-label', 'Pengaturan kedua kota');
  const sections = [...form.querySelectorAll(':scope > details')];
  sections.forEach((section, index) => { section.open = index === 0; });
  document.querySelectorAll('input[type=number]').forEach(input => {
    input.inputMode = input.step === '1' || !input.step ? 'numeric' : 'decimal';
  });
  // Column headings alone do not give the gate inputs an accessible name.
  document.querySelectorAll('.gate-share-row').forEach(row => {
    const headings = row.parentElement.querySelectorAll('.gate-share-head span');
    row.querySelectorAll('input').forEach((input, index) => {
      input.setAttribute('aria-label', `${row.firstElementChild.textContent} · ${headings[index + 1].textContent} (%)`);
    });
  });
  document.querySelector('.settings-link').addEventListener('click', () => {
    document.getElementById('scenario-settings').open = true;
  });
  const status = document.getElementById('apply-status');
  form.querySelector('.section-title').after(status);
}
