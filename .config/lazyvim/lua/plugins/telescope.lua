return {
  {
    "nvim-telescope/telescope.nvim",
    opts = {
      defaults = {
        mappings = {
          i = {
            ["<a-d>"] = "find_files_with_hidden",
          },
        },
      },
    },
  },
}
