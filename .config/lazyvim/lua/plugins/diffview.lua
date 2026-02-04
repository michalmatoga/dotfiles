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
        set_hl(0, "DiffAdd", { bg = "#1f442d" })
        set_hl(0, "DiffDelete", { bg = "#512026" })
        set_hl(0, "DiffChange", { bg = "#1f314d" })
        set_hl(0, "DiffText", { bg = "#2d4b6b", bold = true })
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

      local map = vim.keymap.set

      local function get_default_branch_name()
        local result = vim.system({ "git", "rev-parse", "--verify", "main" }, { text = true }):wait()
        return result.code == 0 and "main" or "master"
      end

      map("n", "<leader><leader>hh", "<Cmd>DiffviewFileHistory<CR>", { desc = "Repo history" })
      map("n", "<leader><leader>hf", "<Cmd>DiffviewFileHistory --follow %<CR>", { desc = "File history" })
      map("n", "<leader><leader>hl", "<Cmd>.DiffviewFileHistory --follow<CR>", { desc = "Line history" })
      map("v", "<leader><leader>hl", "<Esc><Cmd>'<,'>DiffviewFileHistory --follow<CR>", { desc = "Range history" })

      map("n", "<leader><leader>d", "<Cmd>DiffviewOpen<CR>", { desc = "Repo diff" })
      map("n", "<leader><leader>hm", function()
        vim.cmd("DiffviewOpen " .. get_default_branch_name())
      end, { desc = "Diff against master" })
      map("n", "<leader><leader>hM", function()
        vim.cmd("DiffviewOpen HEAD..origin/" .. get_default_branch_name())
      end, { desc = "Diff against origin/master" })

      local function with_gitsigns(action)
        local ok, gs = pcall(require, "gitsigns")
        if ok then
          action(gs)
        end
      end

      map("n", "<leader><leader>vw", function()
        with_gitsigns(function(gs)
          if gs.toggle_word_diff then
            gs.toggle_word_diff()
          end
        end)
      end, { desc = "Toggle word diff" })

      map("n", "<leader><leader>vL", function()
        with_gitsigns(function(gs)
          if gs.toggle_linehl then
            gs.toggle_linehl()
          end
        end)
      end, { desc = "Toggle line highlight" })

      map("n", "<leader><leader>vv", function()
        with_gitsigns(function(gs)
          if gs.toggle_deleted then
            gs.toggle_deleted()
          end
        end)
      end, { desc = "Toggle deleted lines" })

      map("n", "<leader><leader>vh", function()
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

      map("n", "<leader><leader>vc", "<Cmd>CompareClipboard<CR>", { desc = "Compare clipboard" })
      map("v", "<leader><leader>vc", "<Esc><Cmd>CompareClipboardSelection<CR>", { desc = "Compare clipboard selection" })

      function _G.toggle_diffview()
        local bufnr = vim.api.nvim_get_current_buf()
        local buftype = vim.api.nvim_get_option_value("buftype", { buf = bufnr })
        if buftype == "nofile" then
          vim.cmd("DiffviewClose")
        else
          vim.cmd("DiffviewOpen")
        end
      end

      map("n", "<leader>gD", "<Cmd>lua toggle_diffview()<CR>", { desc = "DiffView toggle" })
    end,
  },
}
