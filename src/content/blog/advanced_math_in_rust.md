---
title: "Advanced Math in Rust"
tag: "programming"
publishDate: "Jun 13, 2026"
heroImage: "../../images/adv_math.jpg"
heroImageAlt: "A robot solving complex mathematical problems on a whiteboard"
---
## What is Rust?
Rust is a fast and memory efficient general programming language that emphasizes type safety, concurrency, and memory safety.

It is an interesting language to say the least, considering most of my developer experience is using Java Frameworks.

Nevertheless, I definitely think Rust will be able to handle solving complex math with ease (and speed!).

## The problem
While following the official [Rust Book](https://doc.rust-lang.org/stable/book/) to learn the basics, I came across an interesting problem to attempt solving.

    "You made it! This was a sizable chapter: You learned about variables, scalar and compound data types, functions, comments, `if` expressions, and loops! To practice with the concepts discussed in this chapter, try building programs to do the following:

    - Convert temperatures between Fahrenheit and Celsius.
    - Generate the nth Fibonacci number.
    - Print the lyrics to the Christmas carol “The Twelve Days of Christmas,” taking advantage of the repetition in the song."

The problem we're interested in is `Generating the nth Fibonacci number`.

## Walkthrough
I first began the project by creating a new rust project in my working directory with the `cargo new nth_fibonacci` command. This created a new project with proper configuration that attaches to my Rust Language Server Protocol (LSP). This gives me linter hints, completion suggestions and other helpful utilites to boost my productivity.

I launched my IDE - Neovim and begin to brainstorm this problems solution.

First we need to define what the fibonacci sequence even is. One quick DuckDuckGo search later, we land on the official definition of the [Fibonacci Sequence](https://en.wikipedia.org/wiki/Fibonacci_sequence).

The formula is as follows:

![Fibonacci](../../images/fibonacci.svg)

At first glance, its definitely not the easiest to understand so let's break it down.

![Phi and Psi](../../images/phi_psi.svg)

We declare both greek symbols, `Phi φ` and `Psi ψ`. `Phi` is also known as the `Golden Ratio` and its conjugate is `Psi`.

So now that we have both declared, we can see that both `Phi` and `Psi` need to be multiplied by the exponent of n in which we are trying to solve, and then divided by the square root of 5.

This gives us the function we need to translate into the world of Rust.

Let's begin coding:

First we need to grab input from the user of our application. This can be accomplished by instantiating a new mutable string variable and reading a line of input from the `stdin()`. We will put this logic into our `main()` function, and describe to the user what we expect from their input using a `println!()` macro included in Rust.

``` rs
use std::io;

fn main() {
let mut line = String::new();

    println!("Enter a number to calculate the (n)th fibonacci number");

    io::stdin()
        .read_line(&mut line)
        .expect("Failed to read line.");

    ...
}
```

We've now read the value at the address of our `line` variable, this is the users input.

Next we need to parse the user's input as a 32-bit floating point number, in Rust this is defined as `f32`. We do this by using `match`, which is a control flow construct responsible for pattern matching. This allows us to do away with unwanted data e.g. any non `f32` number.

``` rs
...

let num: f32 = match line.trim().parse() {
        Ok(n) => n,
        Err(_) => return,
    };
```

We now have access to a new `num` variable set to the users input represented as a `f32` number. To handle errors (the best way I currently know how) the `Err(_) => return` statement gracefully exits the program to prevent a panic.

Let's pass the `num` variable to a newly defined function we will create called `get_nth_fibonacci()`

``` rs
fn get_nth_fibonacci(n: f32) -> f32 {
    (((((1.0 + (5.0_f32.sqrt())) / 2.0).powf(n)) - (((1.0 - (5.0_f32.sqrt())) / 2.0).powf(n)))
        / (5.0_f32.sqrt()))
    .round()
}
```

This new function represents exactly the formula we visted earlier, only here we accept a `f32` parameter and return an `f32` value, or the nth fibonacci number.

We are almost done! The last thing we need to do now is to print the nth fibonacci number to the console. We do this by declaring an imutable variable equal to the output of our new `get_nth_fibonacci()` function.

``` rs
...

let nth_fibonacci = get_nth_fibonacci(num);

println!("nth fibonacci: {nth_fibonacci}");

```

Viola! Let's test it.

## The Results
Let's take full advantage of our `rustc` compiler by running `cargo check`. This ensures our logic adds up, and that our program will successfully compile.

``` bash
╭─dominickcs@nixos ~/Projects/learnRust/nth_fibonacci ‹master●› 
╰─$ cargo check
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.01s
```

Nice, no errors!

Let's run it with `cargo run`

``` bash
╭─dominickcs@nixos ~/Projects/learnRust/nth_fibonacci ‹master●› 
╰─$ cargo run
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.01s
     Running `target/debug/nth_fibonacci`
Enter a number to calculate the (n)th fibonacci number
20
nth fibonacci: 6765
```

There you have it. Rust doing some pretty neat and advanced mathematics!

I will continue to progress through the official Rust book and come back with more articles soon. Thanks for reading!
