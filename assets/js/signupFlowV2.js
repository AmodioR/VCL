(() => {
  const page = document.querySelector('[data-signup-page]');
  const form = page?.querySelector('.registration-form-v2');
  if (!page || !form) return;

  const steps = Array.from(form.querySelectorAll('[data-signup-step]'));
  const progressItems = Array.from(form.querySelectorAll('[data-progress-step]'));
  let currentStep = 1;

  const getStep = (number) =>
    steps.find((step) => Number(step.dataset.signupStep) === Number(number));

  const setError = (stepNumber, message = '') => {
    const target = form.querySelector(`[data-step-error="${stepNumber}"]`);
    if (target) target.textContent = message;
  };

  const clearError = (stepNumber) => setError(stepNumber, '');

  function showStep(number, { scroll = true } = {}) {
    const nextStep = getStep(number);
    if (!nextStep) return;

    currentStep = Number(number);

    steps.forEach((step) => {
      const isCurrent = Number(step.dataset.signupStep) === currentStep;
      step.hidden = !isCurrent;
      step.classList.toggle('is-active', isCurrent);
    });

    progressItems.forEach((item) => {
      const stepNumber = Number(item.dataset.progressStep);
      item.classList.toggle('is-active', stepNumber === currentStep);
      item.classList.toggle('is-complete', stepNumber < currentStep);
    });

    if (scroll) {
      const progress = form.querySelector('[data-signup-progress]');
      (progress || nextStep).scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function validateTeam() {
    const required = [
      ['team_name', 'Skriv holdets navn.'],
      ['team_level', 'Vælg holdets niveau.'],
      ['captain_name', 'Skriv captain-navn.'],
      ['captain_discord', 'Skriv captainens Discord-brugernavn.'],
      ['captain_email', 'Skriv captainens e-mail.']
    ];

    for (const [name, message] of required) {
      const field = form.querySelector(`[name="${name}"]`);
      if (!field?.value.trim()) {
        setError(1, message);
        field?.focus();
        return false;
      }

      if (name === 'captain_email' && !field.checkValidity()) {
        setError(1, 'Skriv en gyldig e-mailadresse.');
        field.focus();
        return false;
      }
    }

    clearError(1);
    return true;
  }

  function validateRoster() {
    const starterSlots = [1, 2, 3, 4]
      .map((slot) => ({
        slot,
        input: form.querySelector(`[name="player_${slot}"]`),
        typeInput: form.querySelector(`[name="player_${slot}_link_type"]`)
      }))
      .filter(({ input }) => input?.value.trim());

    if (starterSlots.length < 2) {
      setError(2, 'Tilføj mindst 2 spillere til startopstillingen.');
      form.querySelector('[name="player_1"]')?.focus();
      return false;
    }

    for (const { input, typeInput } of starterSlots) {
      if (!typeInput?.value) {
        setError(2, `Vælg den eksisterende profil eller “opret som ny” for ${input.value.trim()}.`);
        input.focus();
        return false;
      }
    }

    const substituteSlots = [1, 2]
      .map((slot) => ({
        input: form.querySelector(`[name="sub_${slot}"]`),
        typeInput: form.querySelector(`[name="sub_${slot}_link_type"]`)
      }))
      .filter(({ input }) => input?.value.trim());

    for (const { input, typeInput } of substituteSlots) {
      if (!typeInput?.value) {
        setError(2, `Vælg den eksisterende profil eller “opret som ny” for ${input.value.trim()}.`);
        input.focus();
        return false;
      }
    }

    clearError(2);
    return true;
  }

  function canLeaveStep(stepNumber) {
    if (form.classList.contains('registration-form--membership-locked')) return false;
    if (stepNumber === 1) return validateTeam();
    if (stepNumber === 2) return validateRoster();
    return true;
  }

  form.querySelectorAll('[data-step-next]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!canLeaveStep(currentStep)) return;
      showStep(Number(button.dataset.stepNext));
    });
  });

  form.querySelectorAll('[data-step-back]').forEach((button) => {
    button.addEventListener('click', () => {
      clearError(currentStep);
      showStep(Number(button.dataset.stepBack));
    });
  });

  form.addEventListener('reset', () => {
    window.setTimeout(() => showStep(1, { scroll: false }), 0);
  });

  showStep(1, { scroll: false });
})();
