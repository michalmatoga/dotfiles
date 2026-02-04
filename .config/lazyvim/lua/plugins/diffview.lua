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
        set_hl(0, "DiffAdd", { bg = "#144620", fg = "#d4f4dd" })
        set_hl(0, "DiffDelete", { bg = "#6F1313", fg = "#f8d7da" })
        set_hl(0, "DiffChange", { bg = "#1F334A", fg = "#d0e7ff" })
        set_hl(0, "DiffText", { bg = "#2C5372", fg = "#d0e7ff" })
      end

      require("diffview").setup({
        enhanced_diff_hl = true,
        use_icons = true,
        view = {
          default = {
            layout = "diff2_vertical",
            winbar_info = true,
          },
          file_history = {
            layout = "diff2_vertical",
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
      function _G.toggle_diffview()
        local bufnr = vim.api.nvim_get_current_buf()
        local buftype = vim.api.nvim_get_option_value("buftype", { buf = bufnr }) -- plus some comment
        if buftype == "nofile" then
          vim.cmd("DiffviewClose")
        else
          vim.cmd("DiffviewOpen")
        end
      end
      vim.keymap.set("n", "<leader>gD", "<cmd>lua toggle_diffview()<CR>", { desc = "DiffView toggle" })
    end,
  },
}
