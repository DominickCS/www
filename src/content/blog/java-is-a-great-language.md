---
title: "Java is a great programming language, here's why..."
description: "This is a test post to see how blog posts are parsed and rendered within an astro project"
publishDate: "Jun 23 2026"
updatedDate: "Jun 24 2026"
heroImage: "../../images/hacking.jpg"
heroImageAlt: "An image of code"
---

## Hello

### World?

This is awesome!

I love to program, I have been doing it for quite some time now.

This page was written with the [Astro](https://astro.build) framework!

Run this code:

```java
// Artwork Service Class
package com.valdivia.art.service;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import com.stripe.StripeClient;
import com.stripe.exception.StripeException;
import com.stripe.model.Price;
import com.stripe.model.Product;
import com.stripe.model.checkout.Session;
import com.stripe.param.PriceCreateParams;
import com.stripe.param.ProductCreateParams;
import com.stripe.param.ProductUpdateParams;
import com.stripe.param.checkout.SessionCreateParams;
import com.stripe.param.checkout.SessionCreateParams.BillingAddressCollection;
import com.valdivia.art.dto.request.ArtworkEditRequest;
import com.valdivia.art.dto.request.ArtworkUploadRequest;
import com.valdivia.art.dto.request.PurchaseRequest;
import com.valdivia.art.dto.response.OrderResponse;
import com.valdivia.art.entity.Artwork;
import com.valdivia.art.entity.ArtworkImage;
import com.valdivia.art.entity.Order;
import com.valdivia.art.entity.User;
import com.valdivia.art.repository.ArtworkImageRepository;
import com.valdivia.art.repository.ArtworkRepository;
import com.valdivia.art.repository.OrderRepository;
import com.valdivia.art.repository.UserRepository;

import lombok.RequiredArgsConstructor;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

@Service
@RequiredArgsConstructor
public class ArtworkService {
  private final S3Client s3Client;
  private final ArtworkRepository artworkRepository;
  private final StripeClient stripeClient;
  private final UserRepository userRepository;
  private final OrderRepository orderRepository;
  private final ImageUploadConversionService imageUploadConversionService;
  private final ArtworkImageRepository artworkImageRepository;

  @Value("${stripe.success-url}")
  private String successURL;

  @Value("${garage.bucket}")
  private String bucket;

  @Value("${garage.public-url}")
  private String publicURLBase;

  public ResponseEntity<String> uploadArtwork(List<MultipartFile> artworkImages, ArtworkUploadRequest request) {
    try {
      Artwork artwork = new Artwork();
      artwork.setTitle(request.title());
      artwork.setPrice(request.price());
      artwork.setYearCompleted(request.yearCompleted());
      artwork.setHeightInches(request.heightInches());
      artwork.setWidthInches(request.widthInches());
      artwork.setDepthInches(request.depthInches());
      artwork.setDescription(request.description());
      artwork.setMedium(request.medium());
      artwork.setWeight(request.weight());
      artwork.setForSale(request.forSale());
      artwork.setActive(true);
      artwork.setAvailableQuantity(request.availableQuantity());

      List<String> imageURLs = new ArrayList<>();

      for (int i = 0; i < artworkImages.size(); i++) {
        byte[] imageBytes = imageUploadConversionService.convertAndCompress(artworkImages.get(i));
        String artworkObjectID = request.title().replaceAll(" ", "-") + "-" + i + "-" + UUID.randomUUID();

        s3Client.putObject(
            PutObjectRequest.builder()
                .bucket(bucket)
                .key(artworkObjectID)
                .contentType("image/jpeg")
                .build(),
            RequestBody.fromBytes(imageBytes));

        String imageURL = publicURLBase + artworkObjectID;
        imageURLs.add(imageURL);

        ArtworkImage artworkImage = new ArtworkImage();
        artworkImage.setImageURL(imageURL);
        artworkImage.setArtworkObjectKey(artworkObjectID);
        artworkImage.setArtwork(artwork);
        artworkImage.setDisplayOrder(i);
        artwork.getImages().add(artworkImage);

        if (i == request.primaryImageIndex()) {
          artwork.setImageURL(imageURL);
          artwork.setArtworkObjectKey(artworkObjectID);
        }
      }

      ProductCreateParams productParams = ProductCreateParams.builder()
          .setName(request.title())
          .setActive(true)
          .addAllImage(imageURLs)
          .build();
      Product product = stripeClient.products().create(productParams);

      PriceCreateParams priceParams = PriceCreateParams.builder()
          .setProduct(product.getId())
          .setCurrency("usd")
          .setUnitAmount(request.price().multiply(BigDecimal.valueOf(100)).longValue())
          .build();
      Price price = stripeClient.prices().create(priceParams);

      artwork.setStripeProductID(product.getId());
      artwork.setStripePriceID(price.getId());
      artworkRepository.save(artwork);

      return ResponseEntity.ok("Your artwork has uploaded successfully!");

    } catch (Exception e) {
      System.out.println(e);
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
          .body("There was a problem uploading your artwork. Contact your administrator for assistance.");
    }
  }

  public ResponseEntity<String> archiveArtwork(Long artworkID) throws StripeException {
    try {
      Artwork artwork = artworkRepository.findById(artworkID).orElseThrow(NoSuchElementException::new);

      stripeClient.products().update(artwork.getStripeProductID(),
          ProductUpdateParams.builder().setActive(false).build());

      artwork.setActive(false);
      artwork.setForSale(false);

      artworkRepository.save(artwork);

      return ResponseEntity.ok("Artwork was archived successfully!");

    } catch (NoSuchElementException e) {
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
          .body("Artwork with the specified ID doesn't exist.");
    } catch (StripeException e) {
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
          .body("The Stripe API has ran into an error. Contact your administrator. " +
              e.getMessage());
    }
  }

  public ResponseEntity<String> unarchiveArtwork(Long artworkID) throws StripeException {
    try {
      Artwork artwork = artworkRepository.findById(artworkID).orElseThrow(NoSuchElementException::new);

      stripeClient.products().update(artwork.getStripeProductID(),
          ProductUpdateParams.builder().setActive(true).build());

      artwork.setActive(true);
      artwork.setForSale(true);

      artworkRepository.save(artwork);

      return ResponseEntity.ok("Artwork was unarchived successfully!");

    } catch (NoSuchElementException e) {
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
          .body("Artwork with the specified ID doesn't exist.");
    } catch (StripeException e) {
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
          .body("The Stripe API has ran into an error. Contact your administrator. " +
              e.getMessage());
    }
  }

  public ResponseEntity<String> createCheckoutSession(Long artworkID, PurchaseRequest request) throws StripeException {
    try {
      User user = userRepository.findById(request.userID()).orElseThrow(NoSuchElementException::new);
      Artwork artwork = artworkRepository.findById(artworkID).orElseThrow(NoSuchElementException::new);

      Map<String, String> metadata = new HashMap<>();
      metadata.put("artworkId", String.valueOf(artworkID));
      metadata.put("userId", String.valueOf(user.getId()));

      SessionCreateParams params = SessionCreateParams.builder()
          .setSuccessUrl(successURL)
          .addLineItem(
              SessionCreateParams.LineItem.builder()
                  .setPrice(artwork.getStripePriceID())
                  .setQuantity(1L)
                  .build())
          .putAllMetadata(metadata)
          .setBillingAddressCollection(BillingAddressCollection.REQUIRED)
          .setShippingAddressCollection(
              SessionCreateParams.ShippingAddressCollection.builder()
                  .addAllowedCountry(SessionCreateParams.ShippingAddressCollection.AllowedCountry.US)
                  .build())
          .setCustomer(user.getStripeCustomerID())
          .setMode(SessionCreateParams.Mode.PAYMENT)
          .build();

      Session session = stripeClient.checkout().sessions().create(params);

      return ResponseEntity.ok(session.toJson());

    } catch (NoSuchElementException e) {
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
          .body("Artwork with the specified ID doesn't exist.");
    } catch (StripeException e) {
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
          .body("The Stripe API has ran into an error. Contact your administrator. " +
              e.getMessage());
    }

  }

  public ResponseEntity<List<OrderResponse>> getCustomerOrders(User user) {
    List<Order> orders = orderRepository.findByUserIdOrderByCreatedAtDesc(user.getId());
    return ResponseEntity.ok(orders.stream().map(OrderResponse::from).toList());

  }

  public List<Artwork> getAllArtwork() {
    return artworkRepository.findAllByOrderByYearCompletedDesc();
  }

  public List<Artwork> getActiveArtwork() {
    return artworkRepository.findAllByActive(true);
  }

  public List<Artwork> getSellableArtwork() {
    return artworkRepository.findAllByActiveTrueAndAvailableQuantityGreaterThan(0);

  }

  public Artwork getArtworkDetails(Long id) {
    return artworkRepository.findById(id).orElseThrow(NoSuchElementException::new);
  }

  public List<Artwork> getArtworkByYear(String yearCompleted) {
    return artworkRepository.findAllByYearCompletedAndForSaleFalse(yearCompleted);
  }

  @Transactional
  public ResponseEntity<String> editArtwork(
      Long artworkId,
      List<MultipartFile> newImages,
      ArtworkEditRequest request) {

    try {
      Artwork artwork = artworkRepository.findById(artworkId)
          .orElseThrow(NoSuchElementException::new);

      // ── 1. Delete removed images from S3 and the database ──────────────────
      List<Long> removeIds = request.removeImageIds() != null
          ? request.removeImageIds()
          : List.of();

      if (!removeIds.isEmpty()) {
        List<ArtworkImage> toRemove = artwork.getImages().stream()
            .filter(img -> removeIds.contains(img.getId()))
            .toList();

        for (ArtworkImage img : toRemove) {
          s3Client.deleteObject(
              DeleteObjectRequest.builder()
                  .bucket(bucket)
                  .key(img.getArtworkObjectKey())
                  .build());
        }

        artworkImageRepository.deleteAll(toRemove);
        artwork.getImages().removeAll(toRemove);
      }

      // ── 2. Upload new images, appended after existing ones for now ──────────
      if (newImages != null && !newImages.isEmpty()) {
        for (int i = 0; i < newImages.size(); i++) {
          byte[] imageBytes = imageUploadConversionService.convertAndCompress(newImages.get(i));
          String key = request.title().replaceAll(" ", "-")
              + "-" + UUID.randomUUID();

          s3Client.putObject(
              PutObjectRequest.builder()
                  .bucket(bucket)
                  .key(key)
                  .contentType("image/jpeg")
                  .build(),
              RequestBody.fromBytes(imageBytes));

          ArtworkImage artworkImage = new ArtworkImage();
          artworkImage.setImageURL(publicURLBase + key);
          artworkImage.setArtworkObjectKey(key);
          artworkImage.setArtwork(artwork);
          artworkImage.setDisplayOrder(Integer.MAX_VALUE); // finalized in step 3
          artwork.getImages().add(artworkImage);
        }
      }

      // ── 3. Apply display order ──────────────────────────────────────────────
      // imageOrder contains the IDs of existing images in their new order.
      // New uploads (no ID yet) are appended at the end in upload sequence.
      List<Long> imageOrder = request.imageOrder() != null
          ? request.imageOrder()
          : List.of();

      // Build an ordered list: first the existing images sorted by imageOrder,
      // then any new images (which have no ID yet, identified by null/unset key
      // vs the saved key pattern — simplest: they are the ones not in imageOrder).
      List<ArtworkImage> orderedExisting = imageOrder.stream()
          .map(id -> artwork.getImages().stream()
              .filter(img -> img.getId() != null && img.getId().equals(id))
              .findFirst()
              .orElse(null))
          .filter(img -> img != null)
          .toList();

      List<ArtworkImage> newUploads = artwork.getImages().stream()
          .filter(img -> img.getId() == null
              || imageOrder.stream().noneMatch(id -> id.equals(img.getId())))
          .toList();

      // Any existing images not mentioned in imageOrder keep their relative position
      // at the end (safety net — shouldn't happen with a well-behaved frontend).
      List<ArtworkImage> unmentioned = artwork.getImages().stream()
          .filter(img -> img.getId() != null
              && !removeIds.contains(img.getId())
              && imageOrder.stream().noneMatch(id -> id.equals(img.getId())))
          .toList();

      List<ArtworkImage> finalOrder = new java.util.ArrayList<>();
      finalOrder.addAll(orderedExisting);
      finalOrder.addAll(newUploads);
      finalOrder.addAll(unmentioned);

      for (int i = 0; i < finalOrder.size(); i++) {
        finalOrder.get(i).setDisplayOrder(i);
      }

      // ── 4. Re-elect primary if it was removed ───────────────────────────────
      boolean primaryStillExists = artwork.getImages().stream()
          .anyMatch(img -> img.getArtworkObjectKey() != null
              && img.getArtworkObjectKey().equals(artwork.getArtworkObjectKey()));

      if (!primaryStillExists && !finalOrder.isEmpty()) {
        ArtworkImage newPrimary = finalOrder.get(0);
        artwork.setImageURL(newPrimary.getImageURL());
        artwork.setArtworkObjectKey(newPrimary.getArtworkObjectKey());
      } else if (!finalOrder.isEmpty()) {
        // Always keep artwork.imageURL in sync with whoever is displayOrder=0
        ArtworkImage primary = finalOrder.get(0);
        artwork.setImageURL(primary.getImageURL());
        artwork.setArtworkObjectKey(primary.getArtworkObjectKey());
      }

      // ── 5. Update scalar fields ─────────────────────────────────────────────
      artwork.setTitle(request.title());
      artwork.setHeightInches(request.heightInches());
      artwork.setWidthInches(request.widthInches());
      artwork.setDepthInches(request.depthInches());
      artwork.setWeight(request.weight());
      artwork.setYearCompleted(request.yearCompleted());
      artwork.setForSale(request.forSale());
      artwork.setAvailableQuantity(request.availableQuantity());

      // ── 6. Sync Stripe ──────────────────────────────────────────────────────
      stripeClient.products().update(
          artwork.getStripeProductID(),
          ProductUpdateParams.builder()
              .setName(request.title())
              .build());

      boolean priceChanged = artwork.getPrice().compareTo(request.price()) != 0;
      if (priceChanged) {
        stripeClient.prices().update(
            artwork.getStripePriceID(),
            com.stripe.param.PriceUpdateParams.builder()
                .setActive(false)
                .build());

        com.stripe.model.Price newStripePrice = stripeClient.prices().create(
            com.stripe.param.PriceCreateParams.builder()
                .setProduct(artwork.getStripeProductID())
                .setCurrency("usd")
                .setUnitAmount(request.price().multiply(BigDecimal.valueOf(100)).longValue())
                .build());

        artwork.setStripePriceID(newStripePrice.getId());
      }

      artwork.setPrice(request.price());
      artworkRepository.save(artwork);

      return ResponseEntity.ok("Listing updated successfully!");

    } catch (NoSuchElementException e) {
      return ResponseEntity.status(HttpStatus.NOT_FOUND)
          .body("Artwork with the specified ID doesn't exist.");
    } catch (Exception e) {
      System.out.println(e);
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
          .body("There was a problem updating the listing. Contact your administrator.");
    }
  }
}
```
