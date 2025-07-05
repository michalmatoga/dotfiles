return {
  {
    "sindrets/diffview.nvim",
    opts = {},
    config = function()
      require("diffview").setup({
        view = {
          merge_tool = {
            -- Config for conflicted files in diff views during a merge or rebase.
            layout = "diff3_mixed",
          },
        },
      })
      function _G.toggle_diffview()
        local bufnr = vim.api.nvim_get_current_buf()
        local buftype = vim.api.nvim_buf_get_option(bufnr, "buftype")
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
