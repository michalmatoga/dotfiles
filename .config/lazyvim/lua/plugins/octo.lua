return {
  {
    "pwntester/octo.nvim",
    keys = {
      {
        "<leader>gmi",
        "<cmd>Octo search is:open is:issue assignee:" .. os.getenv("GH_USER") .. " sort:created-asc<CR>",
        desc = "List My Issues (Octo)",
      },
      {
        "<leader>gmr",
        "<cmd>Octo search is:open is:pr review-requested:"
          .. os.getenv("GH_USER")
          .. " archived:false sort:created-asc<CR>",
        desc = "List My Review requests (Octo)",
      },
      {
        "<leader>gmp",
        "<cmd>Octo search is:open is:pr assignee:" .. os.getenv("GH_USER") .. " archived:false sort:created-asc<CR>",
        desc = "List My PRs (Octo)",
      },
    },
  },
}
