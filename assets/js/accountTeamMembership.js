(() => {
  if (!document.querySelector('[data-account-page]')) return;

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function waitForDataLayer() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (window.VCLData) return window.VCLData;
      await wait(100);
    }

    throw new Error('VCLData blev ikke klar.');
  }

  async function waitForDatabase() {
    if (window.vclSupabase) return window.vclSupabase;
    if (window.vclSupabaseReady) return window.vclSupabaseReady;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (window.vclSupabase) return window.vclSupabase;
      await wait(100);
    }

    throw new Error('Supabase blev ikke klar.');
  }

  const escapeHTML = (value = '') =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  function createDialog() {
    let dialog = document.querySelector('[data-leave-team-dialog]');
    if (dialog) return dialog;

    dialog = document.createElement('dialog');
    dialog.className = 'account-team-dialog';
    dialog.setAttribute('data-leave-team-dialog', '');
    dialog.innerHTML = `
      <form method="dialog" class="account-team-dialog__panel">
        <span class="account-team-dialog__kicker">Forlad hold</span>
        <h2 data-leave-team-dialog-title>Er du sikker?</h2>
        <p data-leave-team-dialog-copy></p>

        <div class="account-team-dialog__actions">
          <button type="submit" value="cancel" data-cancel-leave-team>Annuller</button>
          <button type="button" class="account-team-dialog__danger" data-confirm-leave-team>
            Forlad hold
          </button>
        </div>

        <p class="notice" data-leave-team-status aria-live="polite"></p>
      </form>
    `;

    document.body.appendChild(dialog);

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close('cancel');
    });

    return dialog;
  }

  async function getActiveTeam(db, player) {
    const { data: membership, error: membershipError } = await db
      .from('team_members')
      .select('id, team_id, member_role, roster_status')
      .eq('player_id', player.id)
      .is('left_at', null)
      .limit(1)
      .maybeSingle();

    if (membershipError) {
      console.warn('Kunne ikke hente aktivt holdmedlemskab:', membershipError);
    }

    const teamId = membership?.team_id || player.current_team_id || null;
    if (!teamId) return null;

    const { data: team, error: teamError } = await db
      .from('teams')
      .select('id, name, slug, captain_player_id, status')
      .eq('id', teamId)
      .maybeSingle();

    if (teamError) {
      console.warn('Kunne ikke hente spillerens hold:', teamError);
      return null;
    }

    if (!team) return null;

    return {
      membership,
      team,
      isCaptain:
        String(team.captain_player_id || '') === String(player.id) ||
        membership?.member_role === 'captain'
    };
  }

  function renderMembershipControl(context, db) {
    const summary = document.querySelector('[data-claimed-player-summary]');
    if (!summary || !context?.team) return;

    summary.querySelector('[data-account-team-membership]')?.remove();

    const wrapper = document.createElement('div');
    wrapper.className = 'account-team-membership';
    wrapper.setAttribute('data-account-team-membership', '');

    if (context.isCaptain) {
      wrapper.innerHTML = `
        <div>
          <small>Holdmedlemskab</small>
          <strong>Du er captain for ${escapeHTML(context.team.name || 'holdet')}</strong>
          <p>Overdrag captainrollen i team-dashboardet, før du kan forlade holdet.</p>
        </div>
        <a href="team-dashboard.html">Åbn team-dashboard</a>
      `;
      summary.appendChild(wrapper);
      return;
    }

    wrapper.innerHTML = `
      <div>
        <small>Holdmedlemskab</small>
        <strong>${escapeHTML(context.team.name || 'Aktivt hold')}</strong>
        <p>Du bestemmer selv, om din spillerprofil fortsat skal være på rosteret.</p>
      </div>
      <button type="button" data-open-leave-team>Forlad hold</button>
    `;

    summary.appendChild(wrapper);

    const openButton = wrapper.querySelector('[data-open-leave-team]');
    const dialog = createDialog();
    const title = dialog.querySelector('[data-leave-team-dialog-title]');
    const copy = dialog.querySelector('[data-leave-team-dialog-copy]');
    const confirmButton = dialog.querySelector('[data-confirm-leave-team]');
    const status = dialog.querySelector('[data-leave-team-status]');

    openButton?.addEventListener('click', () => {
      if (title) {
        title.textContent = `Er du sikker på, at du vil forlade ${context.team.name || 'dit hold'}?`;
      }

      if (copy) {
        copy.textContent =
          'Du bliver fjernet fra holdets aktive roster og markeret som Free Agent. Handlingen kan ikke fortrydes automatisk.';
      }

      if (status) {
        status.textContent = '';
        status.dataset.status = '';
      }

      if (confirmButton) {
        confirmButton.disabled = false;
        confirmButton.textContent = 'Forlad hold';
      }

      if (typeof dialog.showModal === 'function') {
        dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
    });

    confirmButton?.addEventListener('click', async () => {
      try {
        confirmButton.disabled = true;
        confirmButton.textContent = 'Forlader...';

        if (status) {
          status.textContent = `Fjerner dig fra ${context.team.name || 'holdet'}...`;
          status.dataset.status = 'info';
        }

        const { data, error } = await db.rpc('leave_my_team');
        if (error) throw error;

        const result = Array.isArray(data) ? data[0] : data;
        const teamName = result?.team_name || context.team.name || 'holdet';

        if (status) {
          status.textContent = `Du har forladt ${teamName} og er nu Free Agent.`;
          status.dataset.status = 'success';
        }

        window.setTimeout(() => {
          window.location.reload();
        }, 900);
      } catch (error) {
        console.error('Kunne ikke forlade hold:', error);

        confirmButton.disabled = false;
        confirmButton.textContent = 'Forlad hold';

        if (status) {
          status.textContent = error.message || 'Kunne ikke forlade holdet.';
          status.dataset.status = 'error';
        }
      }
    });
  }

  async function initialise() {
    try {
      const [VCLData, db] = await Promise.all([
        waitForDataLayer(),
        waitForDatabase()
      ]);

      const player = await VCLData.getMyClaimedPlayer?.();
      if (!player) return;

      const context = await getActiveTeam(db, player);
      if (!context?.team) return;

      renderMembershipControl(context, db);
    } catch (error) {
      console.error('Holdmedlemskab kunne ikke initialiseres:', error);
    }
  }

  initialise();
})();
