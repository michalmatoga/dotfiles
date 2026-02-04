return {
  {
    "sindrets/diffview.nvim",
    opts = {},
    config = function()
      require("diffview").setup({
        enhanced_diff_hl = true,
        view = {
          merge_tool = {
            -- Config for conflicted files in diff views during a merge or rebase.
            layout = "diff3_mixed",
          },
        },
      })
      function _G.toggle_diffview()
        local bufnr = vim.api.nvim_get_current_buf()
        local buftype = vim.api.nvim_get_option_value("buftype", { buf = bufnr })
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
