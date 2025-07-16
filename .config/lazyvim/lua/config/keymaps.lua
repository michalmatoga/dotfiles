-- Keymaps are automatically loaded on the VeryLazy event
-- Default keymaps that are always set: https://github.com/LazyVim/LazyVim/blob/main/lua/lazyvim/config/keymaps.lua
-- Add any additional keymaps here
--
local ls = require("luasnip")

local map = vim.keymap.set

map("i", "jj", "<Esc>")

map({ "i" }, "<C-K>", function()
  ls.expand()
end, { silent = true })
map({ "i", "s" }, "<C-L>", function()
  ls.jump(1)
end, { silent = true })
map({ "i", "s" }, "<C-J>", function()
  ls.jump(-1)
end, { silent = true })

map({ "i", "s" }, "<C-E>", function()
  if ls.choice_active() then
    ls.change_choice(1)
  end
end, { silent = true })
