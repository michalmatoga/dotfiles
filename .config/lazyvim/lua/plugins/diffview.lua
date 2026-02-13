return {
  {
    "sindrets/diffview.nvim",
    opts = {},
    config = function()
      ---@diagnostic disable-next-line: undefined-global
      local vim = _G.vim
      local set_hl = vim.api.nvim_set_hl
      local create_autocmd = vim.api.nvim_create_autocmd

      local function apply_diff_highlights()
        -- Catppuccin Latte palette-based diff colors
        -- Green tint for additions (using green #40a02b with light bg)
        set_hl(0, "DiffAdd", { bg = "#d4f0d4" })
        -- Red tint for deletions (using red #d20f39 with light bg)
        set_hl(0, "DiffDelete", { bg = "#f5d5d8" })
        -- Blue tint for changes (using blue #1e66f5 with light bg)
        set_hl(0, "DiffChange", { bg = "#dce5f5" })
        -- Darker blue for changed text highlight
        set_hl(0, "DiffText", { bg = "#b8d4f0", bold = true })
      end

      require("diffview").setup({
        enhanced_diff_hl = true,
        use_icons = true,
        view = {
          default = {
            layout = "diff2_horizontal",
            winbar_info = true,
          },
          file_history = {
            layout = "diff2_horizontal",
            winbar_info = true,
          },
          merge_tool = {
            layout = "diff3_mixed",
          },
        },
        file_panel = {
          listing_style = "tree",
          win_config = {
            position = "left",
            width = 40,
          },
        },
      })

      apply_diff_highlights()
      create_autocmd("ColorScheme", {
        pattern = "*",
        callback = apply_diff_highlights,
      })

      vim.o.autoread = true

      create_autocmd({ "FocusGained" }, {
        callback = function()
          vim.cmd("checktime")
          local ok, lib = pcall(require, "diffview.lib")
          if ok and lib.get_current_view() then
            vim.cmd("DiffviewRefresh")
          end
        end,
      })

      local map = vim.keymap.set

      local function get_default_branch_name()
        local result = vim.system({ "git", "rev-parse", "--verify", "main" }, { text = true }):wait()
        return result.code == 0 and "main" or "master"
      end

      map("n", "<leader>gah", "<Cmd>DiffviewFileHistory<CR>", { desc = "Repo history" })
      map("n", "<leader>gaf", "<Cmd>DiffviewFileHistory --follow %<CR>", { desc = "File history" })
      map("n", "<leader>gal", "<Cmd>.DiffviewFileHistory --follow<CR>", { desc = "Line history" })
      map("v", "<leader>gal", "<Esc><Cmd>'<,'>DiffviewFileHistory --follow<CR>", { desc = "Range history" })

      map("n", "<leader>gad", "<Cmd>DiffviewOpen<CR>", { desc = "Repo diff" })
      map("n", "<leader>gam", function()
        vim.cmd("DiffviewOpen " .. get_default_branch_name())
      end, { desc = "Diff against master" })
      map("n", "<leader>gaM", function()
        vim.cmd("DiffviewOpen HEAD..origin/" .. get_default_branch_name())
      end, { desc = "Diff against origin/master" })

      local function with_gitsigns(action)
        local ok, gs = pcall(require, "gitsigns")
        if ok then
          action(gs)
        end
      end

      map("n", "<leader>gaw", function()
        with_gitsigns(function(gs)
          if gs.toggle_word_diff then
            gs.toggle_word_diff()
          end
        end)
      end, { desc = "Toggle word diff" })

      map("n", "<leader>gaL", function()
        with_gitsigns(function(gs)
          if gs.toggle_linehl then
            gs.toggle_linehl()
          end
        end)
      end, { desc = "Toggle line highlight" })

      map("n", "<leader>gav", function()
        with_gitsigns(function(gs)
          if gs.toggle_deleted then
            gs.toggle_deleted()
          end
        end)
      end, { desc = "Toggle deleted lines" })

      map("n", "<leader>gap", function()
        with_gitsigns(function(gs)
          if gs.preview_hunk then
            gs.preview_hunk()
          end
        end)
      end, { desc = "Preview hunk" })

      local function create_command(name, handler, opts)
        pcall(vim.api.nvim_del_user_command, name)
        vim.api.nvim_create_user_command(name, handler, opts or {})
      end

      create_command("Ns", function()
        vim.cmd("vsplit | enew")
        vim.bo.buftype = "nofile"
        vim.bo.bufhidden = "hide"
        vim.bo.swapfile = false
      end)

      create_command("CompareClipboard", function()
        local filetype = vim.api.nvim_get_option_value("filetype", { buf = 0 })
        vim.cmd("tabnew %")
        vim.cmd("Ns")
        vim.cmd([[normal! P]])
        vim.cmd([[windo diffthis]])
        vim.bo.filetype = filetype
      end)

      create_command("CompareClipboardSelection", function()
        vim.cmd([[normal! gv"zy]])
        vim.cmd([[tabnew | setlocal buftype=nofile bufhidden=hide noswapfile]])
        vim.cmd([[normal! V"zp]])
        vim.cmd("Ns")
        vim.cmd([[normal! Vp]])
        vim.cmd([[windo diffthis]])
      end, { range = true })

      map("n", "<leader>gac", "<Cmd>CompareClipboard<CR>", { desc = "Compare clipboard" })
      map("v", "<leader>gac", "<Esc><Cmd>CompareClipboardSelection<CR>", { desc = "Compare clipboard selection" })

      map("n", "<leader>gaq", function()
        local ok, lib = pcall(require, "diffview.lib")
        if ok and lib.get_current_view() then
          vim.cmd("DiffviewClose")
        else
          vim.cmd("tabclose")
        end
      end, { desc = "Close Diffview" })

      function _G.toggle_diffview()
        local ok, lib = pcall(require, "diffview.lib")
        if ok and lib.get_current_view() then
          vim.cmd("DiffviewClose")
        else
          vim.cmd("DiffviewOpen")
        end
      end

      map("n", "<leader>gaD", "<Cmd>lua toggle_diffview()<CR>", { desc = "DiffView toggle" })
    end,
  },
}
