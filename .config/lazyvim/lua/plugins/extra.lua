return {
  {
    "christoomey/vim-tmux-navigator",
    cmd = {
      "TmuxNavigateLeft",
      "TmuxNavigateDown",
      "TmuxNavigateUp",
      "TmuxNavigateRight",
      "TmuxNavigatePrevious",
    },
    keys = {
      { "<c-h>", "<cmd><C-U>TmuxNavigateLeft<cr>" },
      { "<c-j>", "<cmd><C-U>TmuxNavigateDown<cr>" },
      { "<c-k>", "<cmd><C-U>TmuxNavigateUp<cr>" },
      { "<c-l>", "<cmd><C-U>TmuxNavigateRight<cr>" },
      { "<c-\\>", "<cmd><C-U>TmuxNavigatePrevious<cr>" },
    },
  },
  {
    "folke/snacks.nvim",
    opts = {
      picker = {
        hidden = true,
      },
    },
  },
}

-- config = function()
--   local actions = require 'telescope.actions'
--   require('telescope').setup {
--     defaults = {
--       mappings = {
--         i = { ['<c-s>'] = actions.send_to_qflist + actions.open_qflist },
--       },
--     },
--     pickers = {
--       find_files = {
--         find_command = { 'rg', '--files', '--hidden', '-g', '!.git' },
--       },
--     },
--     extensions = {
--       ['ui-select'] = {
--         require('telescope.themes').get_dropdown(),
--       },
--       tmuxinator = {
--         select_action = 'switch', -- | 'stop' | 'kill'
--         stop_action = 'stop', -- | 'kill'
--         disable_icons = false,
--       },
--     },
--   }
